package ledger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// BalanceMinorTx returns sum of ledger lines for user inside an open transaction.
func BalanceMinorTx(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries WHERE user_id = $1::uuid
	`, userID).Scan(&sum)
	return sum, err
}

// ApplyCreditTx inserts a ledger line using tx (idempotent by idempotency_key).
func ApplyCreditTx(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	var metaJSON []byte
	if meta != nil {
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			return false, err
		}
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, metadata)
		VALUES ($1::uuid, $2, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb))
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID, amountMinor, currency, entryType, idempotencyKey, metaJSON)
	if err != nil {
		return false, fmt.Errorf("ledger insert: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// ApplyDebitTx records a negative movement (amountMinor positive in magnitude).
func ApplyDebitTx(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("ledger debit: amount must be positive")
	}
	return ApplyCreditTx(ctx, tx, userID, currency, entryType, idempotencyKey, -amountMinor, meta)
}
