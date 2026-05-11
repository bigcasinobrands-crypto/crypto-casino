package ledger

import (
	"context"
	"fmt"
	"strings"

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

// BalanceCashInCurrencyTx returns the cash pocket balance for a single ledger currency row
// (e.g. EUR settlement cash without summing unrelated crypto-denominated pockets).
func BalanceCashInCurrencyTx(ctx context.Context, tx pgx.Tx, userID, currency string) (int64, error) {
	ccy := strings.ToUpper(strings.TrimSpace(currency))
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash' AND currency = $2
	`, userID, ccy).Scan(&sum)
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

// ApplyDebitTx records a negative movement in the cash pocket (amountMinor positive in magnitude).
func ApplyDebitTx(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("ledger debit: amount must be positive")
	}
	return ApplyCreditWithPocketTx(ctx, tx, userID, currency, entryType, idempotencyKey, -amountMinor, PocketCash, meta)
}

// ApplyDebitTxWithPocket records a negative movement in the given pocket.
func ApplyDebitTxWithPocket(ctx context.Context, tx pgx.Tx, userID, currency, entryType, idempotencyKey string, amountMinor int64, pocket string, meta map[string]any) (inserted bool, err error) {
	if amountMinor <= 0 {
		return false, fmt.Errorf("ledger debit: amount must be positive")
	}
	return ApplyCreditWithPocketTx(ctx, tx, userID, currency, entryType, idempotencyKey, -amountMinor, pocket, meta)
}
