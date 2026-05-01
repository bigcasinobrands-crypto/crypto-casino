package bonus

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RecordRakebackBurstConsumption reserves idempotent ledger for burst windows (Phase 3 extension).
func RecordRakebackBurstConsumption(ctx context.Context, pool *pgxpool.Pool, userID, windowKey, idempotencyKey string, tierID *int, deltaMinor int64) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO vip_rakeback_burst_ledger (user_id, burst_window_key, tier_id, rebate_delta_minor, idempotency_key)
		VALUES ($1::uuid, $2, $3, $4, $5)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID, windowKey, tierID, deltaMinor, idempotencyKey)
	return err
}
