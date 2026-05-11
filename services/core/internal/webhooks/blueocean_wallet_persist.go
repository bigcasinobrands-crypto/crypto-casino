package webhooks

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const boSeamlessProvider = "blueocean"

// boWalletTxAcquireMaxAttempts retries unique-violation races when concurrent callbacks use different
// transaction_id spellings that map to the same logical id (e.g. ez-hex vs bare hex).
const boWalletTxAcquireMaxAttempts = 64

type boSQLExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// boSeamlessPersistMeta is optional context from the callback stored on the wallet transaction row.
type boSeamlessPersistMeta struct {
	Username      string
	RoundID       string
	GameID        string
	SessionID     string
	GamesessionID string
	AmountMinor   *int64
}

func boMarshalWalletResponseJSON(status int, balanceMinor int64, msg string) ([]byte, error) {
	type body struct {
		Status  string `json:"status"`
		Balance string `json:"balance"`
		Msg     string `json:"msg,omitempty"`
	}
	out := body{
		Status:  strconv.Itoa(status),
		Balance: formatBOBalanceMinor(balanceMinor),
	}
	if strings.TrimSpace(msg) != "" {
		out.Msg = msg
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(&out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// boWalletTxAcquire locks or creates the idempotency row for (provider, user_id, action, transaction_id).
// remote_id on the row is the canonical link id (keyRemote) for audit; uniqueness is per internal user.
// response_json is filled in the same DB transaction as ledger effects so concurrent replays never
// observe a committed ledger row with an empty stored response.
func boWalletTxAcquire(ctx context.Context, tx pgx.Tx, userID, keyRemote, action, txnWire, ccy string, meta boSeamlessPersistMeta) (rowID int64, replay []byte, replayBal int64, replaySt int, err error) {
	txnWire = strings.TrimSpace(txnWire)
	if txnWire == "" || txnWire == "na" {
		return 0, nil, 0, 0, nil
	}
	keyRemote = strings.TrimSpace(keyRemote)
	if keyRemote == "" {
		return 0, nil, 0, 0, fmt.Errorf("blueocean wallet: empty remote_id for idempotency")
	}
	ccy = strings.ToUpper(strings.TrimSpace(ccy))
	if ccy == "" {
		ccy = "EUR"
	}

	var amount any
	if meta.AmountMinor != nil {
		amount = *meta.AmountMinor
	}

	userUUID := strings.TrimSpace(userID)
	lookupIDs := boWalletTxnIDLookupVariants(txnWire)
	if len(lookupIDs) == 0 {
		lookupIDs = []string{txnWire}
	}
	for attempt := 0; attempt < boWalletTxAcquireMaxAttempts; attempt++ {
		var raw []byte
		var st sql.NullInt64
		var bal sql.NullInt64
		qErr := tx.QueryRow(ctx, `
			SELECT id, response_json, status_code, balance_after_minor
			FROM blueocean_wallet_transactions
			WHERE provider = $1 AND user_id = $2::uuid AND action = $3 AND transaction_id = ANY($4::text[])
			ORDER BY CASE WHEN transaction_id = $5 THEN 0 ELSE 1 END, id ASC
			LIMIT 1
			FOR UPDATE
		`, boSeamlessProvider, userUUID, action, lookupIDs, txnWire).Scan(&rowID, &raw, &st, &bal)
		if qErr == nil {
			if len(raw) > 0 && st.Valid && bal.Valid {
				return rowID, raw, bal.Int64, int(st.Int64), nil
			}
			return rowID, nil, 0, 0, nil
		}
		if !errors.Is(qErr, pgx.ErrNoRows) {
			return 0, nil, 0, 0, qErr
		}

		_, insErr := tx.Exec(ctx, `
			INSERT INTO blueocean_wallet_transactions (
				provider, remote_id, user_id, username, action, transaction_id, currency,
				round_id, game_id, session_id, gamesession_id, amount_minor, amount_decimal
			) VALUES (
				$1, $2, $3::uuid, NULLIF(trim(both from $4), ''), $5, $6, $7,
				NULLIF(trim(both from $8), ''), NULLIF(trim(both from $9), ''), NULLIF(trim(both from $10), ''), NULLIF(trim(both from $11), ''),
				$12,
				CASE WHEN $12::bigint IS NOT NULL THEN ($12::numeric / 100.0) ELSE NULL END
			)
		`, boSeamlessProvider, keyRemote, userUUID, meta.Username, action, txnWire, ccy,
			meta.RoundID, meta.GameID, meta.SessionID, meta.GamesessionID, amount)
		if insErr != nil {
			var pgErr *pgconn.PgError
			if errors.As(insErr, &pgErr) && pgErr.Code == "23505" {
				continue
			}
			return 0, nil, 0, 0, insErr
		}
	}
	return 0, nil, 0, 0, fmt.Errorf("blueocean wallet: acquire wallet tx row: exceeded attempts")
}

// boLockOriginalDebitWalletRow finds a stored debit row for rollback, scoped to the player.
// When debit_ledger_idem_suffix / split columns were persisted at debit time, rollbacks use those
// exclusively so ledger reversal cannot miss the original idempotency keys.
func boLockOriginalDebitWalletRow(ctx context.Context, tx pgx.Tx, userUUID, keyRemote, txnWire string) (
	rowID int64,
	storedTxnID string,
	debitLedgerSuffix string,
	roundID string,
	amountMinor int64,
	hasAmount bool,
	debitCashSplit int64,
	debitBonusSplit int64,
	hasPersistedSplit bool,
	rolledBack bool,
	err error,
) {
	userUUID = strings.TrimSpace(userUUID)
	keyRemote = strings.TrimSpace(keyRemote)
	variants := boWalletTxnIDLookupVariants(txnWire)
	if len(variants) == 0 {
		return 0, "", "", "", 0, false, 0, 0, false, false, nil
	}
	var round sql.NullString
	var amt sql.NullInt64
	var suffix sql.NullString
	var cashSplit, bonusSplit sql.NullInt64
	qErr := tx.QueryRow(ctx, `
		SELECT id, transaction_id,
		       debit_ledger_idem_suffix,
		       round_id, amount_minor,
		       debit_from_cash_minor, debit_from_bonus_minor,
		       rolled_back
		FROM blueocean_wallet_transactions
		WHERE provider = $1 AND remote_id = $2 AND action = 'debit' AND user_id = $3::uuid
		  AND transaction_id = ANY($4::text[])
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, boSeamlessProvider, keyRemote, userUUID, variants).Scan(
		&rowID, &storedTxnID, &suffix, &round, &amt, &cashSplit, &bonusSplit, &rolledBack,
	)
	if errors.Is(qErr, pgx.ErrNoRows) {
		return 0, "", "", "", 0, false, 0, 0, false, false, nil
	}
	if qErr != nil {
		return 0, "", "", "", 0, false, 0, 0, false, false, qErr
	}
	rd := ""
	if round.Valid {
		rd = strings.TrimSpace(round.String)
	}
	if suffix.Valid {
		debitLedgerSuffix = strings.TrimSpace(suffix.String)
	}
	if cashSplit.Valid || bonusSplit.Valid {
		hasPersistedSplit = true
		if cashSplit.Valid {
			debitCashSplit = cashSplit.Int64
		}
		if bonusSplit.Valid {
			debitBonusSplit = bonusSplit.Int64
		}
	} else if debitLedgerSuffix != "" {
		hasPersistedSplit = true
	}
	var totMinor int64
	var hasAmt bool
	if amt.Valid {
		totMinor = amt.Int64
		hasAmt = true
	}
	return rowID, storedTxnID, debitLedgerSuffix, rd, totMinor, hasAmt, debitCashSplit, debitBonusSplit, hasPersistedSplit, rolledBack, nil
}

// boFindCompletedRollbackReplay returns an earlier rollback callback response for idempotent replays
// when the debit row is already marked rolled_back (e.g. legacy state) or transaction_id spelling differs.
func boFindCompletedRollbackReplay(ctx context.Context, tx pgx.Tx, userUUID, txnWire string) (rep []byte, repBal int64, repSt int, ok bool, err error) {
	variants := boWalletTxnIDLookupVariants(txnWire)
	if len(variants) == 0 {
		return nil, 0, 0, false, nil
	}
	userUUID = strings.TrimSpace(userUUID)
	var raw []byte
	var st sql.NullInt64
	var bal sql.NullInt64
	qErr := tx.QueryRow(ctx, `
		SELECT response_json, status_code, balance_after_minor
		FROM blueocean_wallet_transactions
		WHERE provider = $1 AND user_id = $2::uuid AND action = 'rollback'
		  AND transaction_id = ANY($3::text[])
		  AND response_json IS NOT NULL AND response_json != 'null'::jsonb
		  AND status_code IS NOT NULL AND balance_after_minor IS NOT NULL
		ORDER BY id DESC
		LIMIT 1
	`, boSeamlessProvider, userUUID, variants).Scan(&raw, &st, &bal)
	if errors.Is(qErr, pgx.ErrNoRows) {
		return nil, 0, 0, false, nil
	}
	if qErr != nil {
		return nil, 0, 0, false, qErr
	}
	if len(raw) > 0 && st.Valid && bal.Valid {
		return raw, bal.Int64, int(st.Int64), true, nil
	}
	return nil, 0, 0, false, nil
}

func boSaveWalletTxResponse(ctx context.Context, ex boSQLExecutor, rowID int64, statusCode int, balanceBefore, balanceAfter int64, amountMinor *int64, responseJSON []byte) error {
	if rowID == 0 {
		return nil
	}
	var amt any
	if amountMinor != nil {
		amt = *amountMinor
	}
	_, err := ex.Exec(ctx, `
		UPDATE blueocean_wallet_transactions
		SET status_code = $2,
		    balance_before_minor = $3,
		    balance_after_minor = $4,
		    amount_minor = COALESCE($5, amount_minor),
		    amount_decimal = CASE WHEN $5::bigint IS NOT NULL THEN ($5::numeric / 100.0) ELSE amount_decimal END,
		    response_json = $6::jsonb,
		    updated_at = now()
		WHERE id = $1
	`, rowID, statusCode, balanceBefore, balanceAfter, amt, responseJSON)
	return err
}
