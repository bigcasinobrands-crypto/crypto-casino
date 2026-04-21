// Package ledger is the cash-balance source of truth. Entry types follow
// deposit.*, game.*, withdrawal.*, promo.* (future BonusHub) conventions; use metadata JSON for promotion_id / source.
package ledger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ApplyCredit inserts a ledger line if idempotency_key is new. Amount in minor units (integer).
// Credits go to the cash pocket unless you use ApplyCreditWithPocket.
func ApplyCredit(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	return ApplyCreditWithPocket(ctx, pool, userID, currency, entryType, idempotencyKey, amountMinor, PocketCash, meta)
}

// ApplyCreditWithPocket inserts a credit (or negative amount) into the given pocket.
func ApplyCreditWithPocket(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	pocket = NormalizePocket(pocket)
	var metaJSON []byte
	if meta != nil {
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			return false, err
		}
	}
	tag, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, pocket, metadata)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID, amountMinor, currency, entryType, idempotencyKey, pocket, metaJSON)
	if err != nil {
		return false, fmt.Errorf("ledger insert: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// BalanceMinor returns playable balance (cash + bonus_locked).
func BalanceMinor(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked')
	`, userID).Scan(&sum)
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
