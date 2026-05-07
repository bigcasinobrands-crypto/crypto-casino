package ledger

import "context"

// CountSuccessfulDepositCredits returns how many positive deposit lines exist for the user.
// Counts deposit.credit entries with amount_minor > 0. deposit.checkout is a phantom
// legacy type with no current writer and is intentionally excluded.
func CountSuccessfulDepositCredits(ctx context.Context, q Querier, userID string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND entry_type = 'deposit.credit'
		  AND amount_minor > 0
	`, userID).Scan(&n)
	return n, err
}
