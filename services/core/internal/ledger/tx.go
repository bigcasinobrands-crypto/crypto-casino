package ledger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// BalanceMinorTx returns the playable balance (cash + bonus_locked) for the user.
func BalanceMinorTx(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	return BalancePlayableTx(ctx, tx, userID)
}

// BalancePlayableTx sums cash and bonus_locked pockets (amounts the game provider may use).
func BalancePlayableTx(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked')
	`, userID).Scan(&sum)
	return sum, err
}

// BalanceCashTx returns the cash pocket balance only (withdrawals debit this pocket).
func BalanceCashTx(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash'
	`, userID).Scan(&sum)
	return sum, err
}

// BalanceBonusLockedTx returns the bonus_locked pocket balance.
func BalanceBonusLockedTx(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'bonus_locked'
	`, userID).Scan(&sum)
	return sum, err
}

// ApplyCreditTx inserts into the cash pocket (idempotent by idempotency_key).
func ApplyCreditTx(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	return ApplyCreditTxWithPocket(ctx, tx, userID, currency, entryType, idempotencyKey, amountMinor, PocketCash, meta)
}

// ApplyCreditTxWithPocket inserts a ledger line using tx (idempotent by idempotency_key).
func ApplyCreditTxWithPocket(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	pocket = NormalizePocket(pocket)
	var metaJSON []byte
	if meta != nil {
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			return false, err
		}
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, pocket, metadata)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID, amountMinor, currency, entryType, idempotencyKey, pocket, metaJSON)
	if err != nil {
		return false, fmt.Errorf("ledger insert: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// ApplyDebitTx records a negative movement in the cash pocket (amountMinor positive in magnitude).
func ApplyDebitTx(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("ledger debit: amount must be positive")
	}
	return ApplyCreditTxWithPocket(ctx, tx, userID, currency, entryType, idempotencyKey, -amountMinor, PocketCash, meta)
}

// ApplyDebitTxWithPocket records a negative movement in the given pocket.
func ApplyDebitTxWithPocket(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("ledger debit: amount must be positive")
	}
	return ApplyCreditTxWithPocket(ctx, tx, userID, currency, entryType, idempotencyKey, -amountMinor, pocket, meta)
}
