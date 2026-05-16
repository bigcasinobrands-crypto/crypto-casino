package raffle

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ActivateScheduledCampaigns promotes scheduled → active when inside the window (idempotent).
func ActivateScheduledCampaigns(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE raffle_campaigns c SET status = 'active', updated_at = now()
		FROM (
		  SELECT id FROM raffle_campaigns
		  WHERE status = 'scheduled'
		    AND start_at <= now()
		    AND end_at >= now()
		  ORDER BY start_at ASC
		  LIMIT 1
		) x
		WHERE c.id = x.id
	`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// WarnStaleActivePastEnd logs active campaigns whose wagering window ended but no draw row exists yet.
func WarnStaleActivePastEnd(ctx context.Context, pool *pgxpool.Pool) {
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM raffle_campaigns c
		WHERE c.status = 'active' AND c.end_at < now()
		  AND NOT EXISTS (SELECT 1 FROM raffle_draws d WHERE d.campaign_id = c.id)
	`).Scan(&n)
	if n > 0 {
		slog.Warn("raffle_active_past_end_without_draw", slog.Int("campaigns", n))
	}
}
