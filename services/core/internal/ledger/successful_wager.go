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

func sumSuccessfulStakeNetForPocketWindow(ctx context.Context, q Querier, userID, pocket string, start, end time.Time) (int64, error) {
	if !start.Before(end) {
		return 0, nil
	}
	var gross, roll int64
	err := q.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(amount_minor) ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN entry_type IN ('game.rollback','sportsbook.rollback') THEN ABS(amount_minor) ELSE 0 END), 0)::bigint
		FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND pocket = $2
		  AND entry_type IN ('game.debit', 'game.bet', 'game.rollback', 'sportsbook.debit', 'sportsbook.rollback')
		  AND created_at >= $3 AND created_at < $4
	`, userID, pocket, start, end).Scan(&gross, &roll)
	if err != nil {
		return 0, err
	}
	n := gross - roll
	if n < 0 {
		return 0, nil
	}
	return n, nil
}

// SumSuccessfulCashStakeForWindow returns net cash stake for the half-open window [start, end) in UTC:
// SUM(abs(stake)) - SUM(abs(rollback)) for pocket cash, floored at zero.
//
// Stakes include both casino (game.debit / game.bet) and sportsbook
// (sportsbook.debit) lines so that downstream consumers (VIP accrual,
// rakeback, daily hunt) cannot accidentally treat sportsbook bettors as
// non-wagering users. Rollbacks are netted from the same product surface.
func SumSuccessfulCashStakeForWindow(ctx context.Context, q Querier, userID string, start, end time.Time) (int64, error) {
	return sumSuccessfulStakeNetForPocketWindow(ctx, q, userID, "cash", start, end)
}

// SumSuccessfulPlayableStakeForWindow is net stake on cash plus bonus_locked pockets for [start, end),
// using the same entry types as SumSuccessfulCashStakeForWindow. This aligns with VIP lifetime accrual
// (cash + bonus_locked) for tier perks that reference "wagering" from the ledger.
func SumSuccessfulPlayableStakeForWindow(ctx context.Context, q Querier, userID string, start, end time.Time) (int64, error) {
	cash, err := sumSuccessfulStakeNetForPocketWindow(ctx, q, userID, "cash", start, end)
	if err != nil {
		return 0, err
	}
	bonus, err := sumSuccessfulStakeNetForPocketWindow(ctx, q, userID, "bonus_locked", start, end)
	if err != nil {
		return 0, err
	}
	return cash + bonus, nil
}
