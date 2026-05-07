package wallet

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Operator payout queue (E-10).
//
// CheckOperatorDailyPayoutBudget returns true if the platform has enough
// budget remaining in the current rolling 24h window to submit a new
// withdrawal of `amountCents` to the payment provider. The budget is the
// configured OperatorDailyPayoutCapCents; the spend so far is the SUM of
// `withdrawal.pending.settled` entries (canonical "money left the house"
// signal) over the past 24h. The function is read-only.
//
// We intentionally count *settled* withdrawals, not just locked ones.
// Locked-but-unsettled withdrawals are reversible by admin reject, and
// counting them would unfairly reduce the cap; the moment a withdrawal
// settles we charge it against the cap.
//
// Returns:
//
//	allowed: true when the new withdrawal fits within the remaining budget
//	spent:   total already-settled USD cents in the window (for logging/UX)
//	budget:  configured cap in USD cents (0 means "no cap")
func CheckOperatorDailyPayoutBudget(ctx context.Context, pool *pgxpool.Pool, amountCents, capCents int64) (allowed bool, spent int64, budget int64, err error) {
	if pool == nil || capCents <= 0 {
		return true, 0, capCents, nil
	}
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE entry_type = 'withdrawal.pending.settled'
		  AND amount_minor < 0
		  AND pocket = 'pending_withdrawal'
		  AND created_at >= now() - INTERVAL '24 hours'
	`).Scan(&spent); err != nil {
		return false, 0, capCents, err
	}
	// `amount_minor` is negative for settled withdrawals (debits the
	// pending pocket); flip the sign so `spent` is positive cents.
	spent = -spent
	if spent < 0 {
		spent = 0
	}
	return spent+amountCents <= capCents, spent, capCents, nil
}
