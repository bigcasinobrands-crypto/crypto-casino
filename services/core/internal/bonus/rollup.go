package bonus

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RollupBonusCampaignDay aggregates user_bonus_instances into bonus_campaign_daily_stats for statDate (UTC date).
func RollupBonusCampaignDay(ctx context.Context, pool *pgxpool.Pool, statDate time.Time) error {
	dayStart := time.Date(statDate.Year(), statDate.Month(), statDate.Day(), 0, 0, 0, 0, time.UTC)
	dayEnd := dayStart.Add(24 * time.Hour)
	_, err := pool.Exec(ctx, `
		INSERT INTO bonus_campaign_daily_stats (
			stat_date, promotion_version_id, grants_count, grant_volume_minor,
			active_instances_end, completed_wr, forfeited, cost_minor
		)
		SELECT $1::date, promotion_version_id,
			COUNT(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::int,
			COALESCE(SUM(granted_amount_minor) FILTER (WHERE created_at >= $2 AND created_at < $3), 0)::bigint,
			COUNT(*) FILTER (WHERE status = 'active')::int,
			COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= $2 AND updated_at < $3)::int,
			COUNT(*) FILTER (WHERE status = 'forfeited' AND updated_at >= $2 AND updated_at < $3)::int,
			COALESCE(SUM(granted_amount_minor) FILTER (WHERE created_at >= $2 AND created_at < $3), 0)::bigint
		FROM user_bonus_instances
		GROUP BY promotion_version_id
		ON CONFLICT (stat_date, promotion_version_id) DO UPDATE SET
			grants_count = EXCLUDED.grants_count,
			grant_volume_minor = EXCLUDED.grant_volume_minor,
			active_instances_end = EXCLUDED.active_instances_end,
			completed_wr = EXCLUDED.completed_wr,
			forfeited = EXCLUDED.forfeited,
			cost_minor = EXCLUDED.cost_minor
	`, dayStart.Format("2006-01-02"), dayStart, dayEnd)
	return err
}
