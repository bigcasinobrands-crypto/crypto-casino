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
func ApplyCredit(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	var metaJSON []byte
	if meta != nil {
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			return false, err
		}
	}
	tag, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, metadata)
		VALUES ($1::uuid, $2, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb))
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID, amountMinor, currency, entryType, idempotencyKey, metaJSON)
	if err != nil {
		return false, fmt.Errorf("ledger insert: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// BalanceMinor returns sum of amount_minor for user (simple Phase-1 view).
func BalanceMinor(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries WHERE user_id = $1::uuid
	`, userID).Scan(&sum)
	return sum, err
}

// ApplyDebit records a negative ledger movement (same row shape as credit). amountMinor must be positive; stored as -amountMinor.
func ApplyDebit(ctx context.Context, pool *pgxpool.Pool, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("ledger debit: amount must be positive")
	}
	return ApplyCredit(ctx, pool, userID, currency, entryType, idempotencyKey, -amountMinor, meta)
}

// AvailableBalance is the sum of ledger lines (cash); BonusHub can wrap later.
func AvailableBalance(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	return BalanceMinor(ctx, pool, userID)
}
