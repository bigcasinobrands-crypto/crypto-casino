package bonus

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VIPHubDeliveryPreview builds optional vip_delivery_preview for GET /v1/rewards/hub.
func VIPHubDeliveryPreview(ctx context.Context, pool *pgxpool.Pool) map[string]any {
	now := time.Now()
	rows, err := pool.Query(ctx, `
		SELECT pipeline, next_run_at, COALESCE(config, '{}'::jsonb)
		FROM vip_delivery_schedules
		WHERE enabled = true AND pipeline IN ('weekly_bonus', 'monthly_bonus')
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var weekly, monthly *string
	for rows.Next() {
		var pipe string
		var nr *time.Time
		var cfg []byte
		if err := rows.Scan(&pipe, &nr, &cfg); err != nil {
			continue
		}
		next := EarliestFutureVIPScheduledInstant(now, pipe, nr, cfg)
		if next == nil {
			continue
		}
		s := next.UTC().Format(time.RFC3339)
		switch pipe {
		case "weekly_bonus":
			weekly = &s
		case "monthly_bonus":
			monthly = &s
		}
	}
	if weekly == nil && monthly == nil {
		return nil
	}
	out := map[string]any{}
	if weekly != nil {
		out["weekly_next_at"] = *weekly
	}
	if monthly != nil {
		out["monthly_next_at"] = *monthly
	}
	return out
}

// VIPRainEligibilityForHub returns rain_eligibility key for hub when an open round exists.
func VIPRainEligibilityForHub(ctx context.Context, pool *pgxpool.Pool, userID string) map[string]any {
	var rid string
	err := pool.QueryRow(ctx, `
		SELECT id::text FROM rain_rounds WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1
	`).Scan(&rid)
	if err != nil {
		return nil
	}
	_ = rid
	_ = userID
	return map[string]any{
		"eligible":      false,
		"next_round_at": nil,
	}
}

// HuntProgramAdminJSON returns raw reward_programs row for daily_hunt (admin editor, includes disabled).
func HuntProgramAdminJSON(ctx context.Context, pool *pgxpool.Pool) (map[string]any, error) {
	var id int64
	var pkey string
	var pvid int64
	var config []byte
	var enabled bool
	err := pool.QueryRow(ctx, `
		SELECT id, program_key, promotion_version_id, config, enabled
		FROM reward_programs WHERE kind = $1 ORDER BY id ASC LIMIT 1
	`, RewardKindDailyHunt).Scan(&id, &pkey, &pvid, &config, &enabled)
	if err == pgx.ErrNoRows {
		return map[string]any{"program": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	var cfg any
	_ = json.Unmarshal(config, &cfg)
	return map[string]any{
		"program": map[string]any{
			"id":                   id,
			"program_key":          pkey,
			"promotion_version_id": pvid,
			"config":               cfg,
			"enabled":              enabled,
		},
	}, nil
}
