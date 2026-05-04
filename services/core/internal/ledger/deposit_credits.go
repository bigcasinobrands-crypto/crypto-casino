package ledger

import "context"

// CountSuccessfulDepositCredits returns how many positive deposit lines exist for the user.
// Counts deposit.credit and deposit.checkout entries with amount_minor > 0 (same basis as FirstDeposit / DepositIndex).
func CountSuccessfulDepositCredits(ctx context.Context, q Querier, userID string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND entry_type IN ('deposit.credit', 'deposit.checkout')
		  AND amount_minor > 0
	`, userID).Scan(&n)
	return n, err
}
