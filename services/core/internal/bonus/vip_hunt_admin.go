package bonus

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UpdateDailyHuntProgramConfig replaces JSON config for the daily_hunt reward_programs row.
func UpdateDailyHuntProgramConfig(ctx context.Context, pool *pgxpool.Pool, raw json.RawMessage) error {
	if len(raw) == 0 {
		return fmt.Errorf("empty config")
	}
	if _, err := parseHuntConfig(raw); err != nil {
		return err
	}
	ct, err := pool.Exec(ctx, `
		UPDATE reward_programs SET config = $1::jsonb WHERE kind = $2
	`, raw, RewardKindDailyHunt)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("no daily_hunt program row")
	}
	return nil
}
