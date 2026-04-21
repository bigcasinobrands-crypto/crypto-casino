package bonus

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EmitOutbound appends a row for CRM / ESP consumers (poll or future webhooks).
func EmitOutbound(ctx context.Context, pool *pgxpool.Pool, eventType string, payload map[string]any) error {
	if pool == nil || eventType == "" {
		return nil
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO bonus_outbound_events (event_type, payload) VALUES ($1, $2::jsonb)
	`, eventType, b)
	return err
}
