package ledger

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// BalancePendingWithdrawal sums the pending_withdrawal pocket (locked for outbound settlement).
func BalancePendingWithdrawal(ctx context.Context, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, userID string) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'pending_withdrawal'
	`, userID).Scan(&sum)
	return sum, err
}

// BalancePendingWithdrawalTx is like BalancePendingWithdrawal inside a transaction.
func BalancePendingWithdrawalTx(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	return BalancePendingWithdrawal(ctx, tx, userID)
}
