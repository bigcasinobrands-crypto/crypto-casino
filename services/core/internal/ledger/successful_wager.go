package ledger

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Querier matches pgxpool.Pool and pgx.Tx for single-row reads.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// SumSuccessfulCashStakeForWindow returns net cash stake for the half-open window [start, end) in UTC:
// SUM(abs(game.debit)) - SUM(abs(game.rollback)) for pocket cash, floored at zero.
func SumSuccessfulCashStakeForWindow(ctx context.Context, q Querier, userID string, start, end time.Time) (int64, error) {
	var gross, roll int64
	err := q.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN entry_type = 'game.debit' THEN ABS(amount_minor) ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN entry_type = 'game.rollback' THEN ABS(amount_minor) ELSE 0 END), 0)::bigint
		FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND pocket = 'cash'
		  AND entry_type IN ('game.debit', 'game.rollback')
		  AND created_at >= $2 AND created_at < $3
	`, userID, start, end).Scan(&gross, &roll)
	if err != nil {
		return 0, err
	}
	n := gross - roll
	if n < 0 {
		return 0, nil
	}
	return n, nil
}
