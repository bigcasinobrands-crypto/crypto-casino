package bonus

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RunVIPLedgerReconciliation compares vip_delivery_run_items amounts to ledger promo lines (extend with tagged queries).
func RunVIPLedgerReconciliation(ctx context.Context, pool *pgxpool.Pool) (drift int64, err error) {
	if pool == nil {
		return 0, nil
	}
	var itemsGranted int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(COALESCE(amount_minor, 0)), 0)::bigint
		FROM vip_delivery_run_items
		WHERE result = 'granted'
		  AND created_at >= now() - interval '30 days'
	`).Scan(&itemsGranted); err != nil {
		return 0, err
	}

	var bonusGranted int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(COALESCE(ubi.granted_amount_minor, 0)), 0)::bigint
		FROM user_bonus_instances ubi
		JOIN vip_delivery_run_items vdi ON vdi.idempotency_key = ubi.idempotency_key
		WHERE vdi.result = 'granted'
		  AND vdi.created_at >= now() - interval '30 days'
	`).Scan(&bonusGranted); err != nil {
		return 0, err
	}
	if itemsGranted > bonusGranted {
		return itemsGranted - bonusGranted, nil
	}
	return bonusGranted - itemsGranted, nil
}
