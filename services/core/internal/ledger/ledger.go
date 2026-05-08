// Package ledger is the cash-balance source of truth. Entry types follow
// deposit.*, game.*, withdrawal.*, promo.* (future BonusHub) conventions; use metadata JSON for promotion_id / source.
package ledger

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// ApplyCredit inserts a ledger line if idempotency_key is new. Amount in minor units (integer).
// Credits go to the cash pocket unless you use ApplyCreditWithPocket.
func ApplyCredit(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	return ApplyCreditWithPocket(ctx, pool, userID, currency, entryType, idempotencyKey, amountMinor, PocketCash, meta)
}

// ApplyCreditTx is like ApplyCredit but runs inside the caller's transaction.
func ApplyCreditTx(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	return ApplyCreditWithPocketTx(ctx, tx, userID, currency, entryType, idempotencyKey, amountMinor, PocketCash, meta)
}

// ApplyCreditWithPocket inserts a credit (or negative amount) into the given pocket.
func ApplyCreditWithPocket(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	return applyCreditWithPocketExec(ctx, pool, userID, currency, entryType, idempotencyKey, amountMinor, pocket, meta)
}

// ApplyCreditWithPocketTx runs ApplyCreditWithPocket using an explicit transaction.
func ApplyCreditWithPocketTx(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	return applyCreditWithPocketExec(ctx, tx, userID, currency, entryType, idempotencyKey, amountMinor, pocket, meta)
}

// ApplyCreditTxWithPocket is an alias for ApplyCreditWithPocketTx (legacy exported name).
func ApplyCreditTxWithPocket(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	return ApplyCreditWithPocketTx(ctx, tx, userID, currency, entryType, idempotencyKey, amountMinor, pocket, meta)
}

func applyCreditWithPocketExec(ctx context.Context, ex execer, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	pocket = NormalizePocket(pocket)
	var metaJSON []byte
	if meta != nil {
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			return false, err
		}
	}
	tag, err := ex.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, pocket, metadata)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID, amountMinor, currency, entryType, idempotencyKey, pocket, metaJSON)
	if err != nil {
		return false, fmt.Errorf("ledger insert: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// RecordNonBalanceEvent writes amount zero to the cash pocket so the activity appears in
// /wallet/transactions without changing balances (e.g. promo.activation, promo.relinquish).
func RecordNonBalanceEvent(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, meta map[string]any) (inserted bool, err error) {
	return ApplyCreditWithPocket(ctx, pool, userID, currency, entryType, idempotencyKey, 0, PocketCash, meta)
}

// BalanceMinor returns playable balance (cash + bonus_locked) across every `currency`
// row in the ledger. Only use this when all movements share one minor-unit convention
// (for example USD cents only). If players hold multiple settlement assets (USDT, ETH, …),
// use BalanceMinorInCurrency for per-asset play limits or wallet.BalancesHandler for reporting.
func BalanceMinor(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked')
	`, userID).Scan(&sum)
	return sum, err
}

// BalanceMinorInCurrency returns playable balance (cash + bonus_locked) for a single ledger
// `currency` code (e.g. USDT, ETH). Amounts are in that asset's minor units.
func BalanceMinorInCurrency(ctx context.Context, pool *pgxpool.Pool, userID, currency string) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(currency))
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked') AND currency = $2
	`, userID, ccy).Scan(&sum)
	return sum, err
}

// ApplyDebit records a negative ledger movement in the cash pocket. amountMinor must be positive; stored as -amountMinor.
func ApplyDebit(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("ledger debit: amount must be positive")
	}
	return ApplyCreditWithPocket(ctx, pool, userID, currency, entryType, idempotencyKey, -amountMinor, PocketCash, meta)
}

// AvailableBalance is playable balance (cash + bonus_locked).
func AvailableBalance(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	return BalanceMinor(ctx, pool, userID)
}

// BalanceCash returns the cash pocket balance only.
func BalanceCash(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash'
	`, userID).Scan(&sum)
	return sum, err
}

// BalanceBonusLocked returns the bonus_locked pocket balance.
func BalanceBonusLocked(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'bonus_locked'
	`, userID).Scan(&sum)
	return sum, err
}
