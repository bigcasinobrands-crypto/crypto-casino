package bonus

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

func insertNotification(ctx context.Context, pool *pgxpool.Pool, userID, kind, title, body string, meta map[string]any) error {
	var metaJSON []byte
	var err error
	if meta != nil {
		metaJSON, err = json.Marshal(meta)
		if err != nil {
			return err
		}
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO player_notifications (user_id, kind, title, body, metadata)
		VALUES ($1::uuid, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
	`, userID, kind, title, body, metaJSON)
	return err
}
