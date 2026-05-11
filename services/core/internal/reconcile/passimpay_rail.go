package reconcile

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RunPassimpayPaymentRailChecks raises operational alerts for stalled PassimPay rail rows.
func RunPassimpayPaymentRailChecks(ctx context.Context, pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	rows, err := pool.Query(ctx, `
		SELECT withdrawal_id::text, user_id::text, COALESCE(provider_order_id,''),
		       COALESCE(internal_amount_minor, amount_minor),
		       COALESCE(NULLIF(TRIM(internal_ledger_currency),''), currency, '')
		FROM payment_withdrawals
		WHERE provider = 'passimpay'
		  AND status = 'LEDGER_LOCKED'
		  AND created_at < now() - INTERVAL '2 hours'
		LIMIT 100
	`)
	if err != nil {
		slog.WarnContext(ctx, "passimpay_rail_reconcile_query", "err", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var wid, uid, orderID, ledgerCcy string
		var amt int64
		if scanErr := rows.Scan(&wid, &uid, &orderID, &amt, &ledgerCcy); scanErr != nil {
			continue
		}
		details, _ := json.Marshal(map[string]any{
			"withdrawal_id":         wid,
			"provider_order_id":   orderID,
			"ledger_currency":     ledgerCcy,
			"internal_amount_minor": amt,
			"reason":              "ledger_locked_over_2h",
		})
		if _, execErr := pool.Exec(ctx, `
			INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
			VALUES ('passimpay_stuck_ledger_locked', NULLIF($1,'')::uuid, 'payment_withdrawals', $2, COALESCE($3::jsonb, '{}'::jsonb))
		`, uid, wid, details); execErr != nil {
			slog.WarnContext(ctx, "passimpay_rail_alert_insert", "withdrawal_id", wid, "err", execErr)
		}
	}
}
