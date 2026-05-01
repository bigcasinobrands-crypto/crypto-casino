package bonus

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VIPTierSnapshotAt returns user's tier snapshot as-of a timestamp.
func VIPTierSnapshotAt(ctx context.Context, pool *pgxpool.Pool, userID string, asOf time.Time) (tierID *int, tierSort int, hasTier bool) {
	var tid *int
	err := pool.QueryRow(ctx, `
		SELECT to_tier_id
		FROM vip_tier_events
		WHERE user_id = $1::uuid AND created_at <= $2
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, userID, asOf).Scan(&tid)
	if err == nil {
		if tid == nil {
			return nil, -1, false
		}
		var sort int
		if qErr := pool.QueryRow(ctx, `SELECT sort_order FROM vip_tiers WHERE id = $1`, *tid).Scan(&sort); qErr == nil {
			return tid, sort, true
		}
		return tid, -1, true
	}
	if err != pgx.ErrNoRows {
		return nil, -1, false
	}

	// Fallback when no historical tier events exist yet.
	var curr *int
	if qErr := pool.QueryRow(ctx, `SELECT tier_id FROM player_vip_state WHERE user_id = $1::uuid`, userID).Scan(&curr); qErr != nil || curr == nil {
		return nil, -1, false
	}
	var sort int
	if qErr := pool.QueryRow(ctx, `SELECT sort_order FROM vip_tiers WHERE id = $1`, *curr).Scan(&sort); qErr == nil {
		return curr, sort, true
	}
	return curr, -1, true
}

func vipRebatePercentAddForTier(ctx context.Context, pool *pgxpool.Pool, tierID int, programKey string) (float64, error) {
	if programKey == "" {
		return 0, nil
	}
	var sum float64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM((config->>'percent_add')::numeric), 0)::float8
		FROM vip_tier_benefits
		WHERE tier_id = $1
		  AND enabled = true
		  AND benefit_type = 'rebate_percent_add'
		  AND COALESCE(TRIM(config->>'rebate_program_key'), '') = $2
	`, tierID, programKey).Scan(&sum)
	if err != nil {
		return 0, err
	}
	return clampVipRebatePercentAdd(sum), nil
}
