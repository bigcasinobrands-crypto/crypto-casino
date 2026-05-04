package ledger

import (
	"context"
	"time"
)

// SumCashGameNetForWindow returns signed cash-pocket net from game activity in [start, end) UTC.
// Sums amount_minor for game.debit, game.credit, and game.rollback on pocket=cash.
// Negative values indicate the player lost in the window; positive indicates net wins.
// Used for cashback-on-net-loss programs so eligibility matches ledger-backed P&L, not provider summaries.
func SumCashGameNetForWindow(ctx context.Context, q Querier, userID string, start, end time.Time) (int64, error) {
	var net int64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash'
		  AND entry_type IN ('game.debit', 'game.credit', 'game.rollback')
		  AND created_at >= $2 AND created_at < $3
	`, userID, start, end).Scan(&net)
	return net, err
}
