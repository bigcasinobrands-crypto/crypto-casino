package webhooks

import (
	"context"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReconcileStaleFystackDeliveries processes webhook rows that stayed unprocessed (e.g. worker crash).
func ReconcileStaleFystackDeliveries(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT id FROM fystack_webhook_deliveries
		WHERE processed = false AND created_at < now() - interval '2 minutes'
		ORDER BY id ASC
		LIMIT 50
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}
	n := 0
	for _, id := range ids {
		settled, err := ProcessFystackWebhookDelivery(ctx, pool, id)
		if err != nil {
			continue
		}
		n++
		if settled != nil {
			_ = bonus.EvaluatePaymentSettled(ctx, pool, *settled)
		}
	}
	return n, nil
}
