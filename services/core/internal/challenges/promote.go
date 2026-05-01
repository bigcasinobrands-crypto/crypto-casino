package challenges

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PromoteAllDueScheduledChallenges sets status to active for scheduled challenges whose window has begun.
// Server-side enforcement: enter and processing paths require status active + time window; this keeps the DB aligned.
func PromoteAllDueScheduledChallenges(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		UPDATE challenges SET status = 'active', updated_at = now()
		WHERE status = 'scheduled' AND starts_at <= now() AND ends_at > now()
	`)
	return err
}

// PromoteScheduledChallengeIfDue promotes a single scheduled challenge when its window has begun.
func PromoteScheduledChallengeIfDue(ctx context.Context, pool *pgxpool.Pool, challengeID string) error {
	if challengeID == "" {
		return nil
	}
	_, err := pool.Exec(ctx, `
		UPDATE challenges SET status = 'active', updated_at = now()
		WHERE id = $1::uuid AND status = 'scheduled' AND starts_at <= now() AND ends_at > now()
	`, challengeID)
	return err
}
