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

// boWalletTxAcquire locks or creates the idempotency row for this (remote, action, transaction_id).
// When replay is non-nil, the handler must write it verbatim (exact BlueOcean retry contract).
func boWalletTxAcquire(ctx context.Context, tx pgx.Tx, userID, keyRemote, action, txnWire, ccy string, meta boSeamlessPersistMeta) (rowID int64, replay []byte, replayBal int64, replaySt int, err error) {
	txnWire = strings.TrimSpace(txnWire)
	if txnWire == "" || txnWire == "na" {
		return 0, nil, 0, 0, nil
	}
	keyRemote = strings.TrimSpace(keyRemote)
	ccy = strings.ToUpper(strings.TrimSpace(ccy))
	if ccy == "" {
		ccy = "EUR"
	}

	var amount any
	if meta.AmountMinor != nil {
		amount = *meta.AmountMinor
	}

	for attempt := 0; attempt < 4; attempt++ {
		var raw []byte
		var st sql.NullInt64
		var bal sql.NullInt64
		qErr := tx.QueryRow(ctx, `
			SELECT id, response_json, status_code, balance_after_minor
			FROM blueocean_wallet_transactions
			WHERE provider = $1 AND remote_id = $2 AND action = $3 AND transaction_id = $4
			FOR UPDATE
		`, boSeamlessProvider, keyRemote, action, txnWire).Scan(&rowID, &raw, &st, &bal)
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
		`, boSeamlessProvider, keyRemote, userID, meta.Username, action, txnWire, ccy,
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
