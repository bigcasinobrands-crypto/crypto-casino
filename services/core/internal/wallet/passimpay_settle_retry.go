package wallet

// P6: LEDGER_SETTLE_FAILED retry worker.
//
// When `withdrawalPassimpay` succeeds at the provider but our ledger settle
// fails (e.g. transient DB outage), the row is parked at status=LEDGER_SETTLE_FAILED
// with the funds still in the user's `pending_withdrawal` pocket. The user
// already saw a 500 — but the funds left the platform via PassimPay, so we
// MUST eventually post the matching ledger entries or the platform liability
// numbers drift forever.
//
// This worker scans for LEDGER_SETTLE_FAILED rows older than a small grace
// window, retries `finalizePassimpayWithdrawLedger`, and after N attempts
// emits a reconciliation_alerts row so ops can intervene.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxLedgerSettleRetryAttempts is the worker stops auto-retrying after this
// many attempts and instead fires a reconciliation alert. Real recovery from
// that point is a manual ops decision — usually a human must look at the
// PassimPay dashboard for the orderId, confirm whether the payout actually
// went out, and either drive the settle by hand or compensate the user.
const MaxLedgerSettleRetryAttempts = 12

// ProcessLedgerSettleFailed scans for withdrawal rows stuck at
// LEDGER_SETTLE_FAILED and retries the ledger finalize step. Returns the
// number of rows successfully recovered. Idempotent — the underlying ledger
// writes use the same idem keys as the original settle attempt, so retries
// are safe against partial-applied ledger state.
func ProcessLedgerSettleFailed(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, batchSize int) (int, error) {
	if batchSize <= 0 {
		batchSize = 25
	}
	rows, err := pool.Query(ctx, `
		SELECT
			withdrawal_id::text, user_id::text, currency, amount_minor,
			provider_order_id, COALESCE(ledger_lock_idem_suffix,''),
			COALESCE(provider_transaction_id,''),
			COALESCE((metadata->>'settle_retry_attempts')::int, 0)
		FROM payment_withdrawals
		WHERE provider = 'passimpay'
		  AND status = 'LEDGER_SETTLE_FAILED'
		  AND updated_at < now() - INTERVAL '30 seconds'
		ORDER BY updated_at ASC
		LIMIT $1
	`, batchSize)
	if err != nil {
		return 0, fmt.Errorf("query stuck withdrawals: %w", err)
	}
	defer rows.Close()

	type stuckRow struct {
		WithdrawalID, UserID, Currency, OrderID, IdemSuffix, ProviderTxID string
		AmountMinor                                                       int64
		Attempts                                                          int
	}
	var batch []stuckRow
	for rows.Next() {
		var s stuckRow
		if err := rows.Scan(&s.WithdrawalID, &s.UserID, &s.Currency, &s.AmountMinor,
			&s.OrderID, &s.IdemSuffix, &s.ProviderTxID, &s.Attempts); err != nil {
			slog.ErrorContext(ctx, "ledger_settle_retry_scan", "err", err)
			continue
		}
		batch = append(batch, s)
	}

	recovered := 0
	for _, s := range batch {
		if s.Attempts >= MaxLedgerSettleRetryAttempts {
			alertStuckWithdrawal(ctx, pool, s.UserID, s.WithdrawalID, s.OrderID, s.AmountMinor, s.Currency, s.Attempts)
			continue
		}
		ok := retryOneSettle(ctx, pool, cfg, s.UserID, s.Currency, s.AmountMinor, s.IdemSuffix, s.OrderID, s.ProviderTxID, s.Attempts+1)
		if ok {
			recovered++
		}
	}
	return recovered, nil
}

func retryOneSettle(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, userID, ccy string, amountMinor int64, idemSuffix, orderID, providerTxID string, attempt int) bool {
	pendingKey := fmt.Sprintf("passimpay:wdr:finalize:pending:%s:%s", orderID, idemSuffix)
	meta := map[string]any{
		"provider_order_id":       orderID,
		"provider_transaction_id": providerTxID,
		"recovery":                "settle_retry",
		"attempt":                 attempt,
	}
	if err := finalizePassimpayWithdrawLedgerWithRetry(ctx, pool, cfg, userID, ccy, amountMinor, pendingKey, orderID, meta); err != nil {
		slog.ErrorContext(ctx, "ledger_settle_retry_failed",
			"order_id", orderID, "attempt", attempt, "err", err)
		bumpRetryMeta(ctx, pool, orderID, attempt, err.Error())
		return false
	}
	if _, err := pool.Exec(ctx, `
		UPDATE payment_withdrawals SET
			status = 'SUBMITTED_TO_PROVIDER',
			failure_reason = NULL,
			metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('settle_retry_attempts', $2::int, 'settle_recovered_at', to_jsonb(now())),
			updated_at = now()
		WHERE provider = 'passimpay'
		  AND provider_order_id = $1
		  AND status = 'LEDGER_SETTLE_FAILED'
	`, orderID, attempt); err != nil {
		slog.ErrorContext(ctx, "ledger_settle_retry_status_update", "order_id", orderID, "err", err)
	}
	slog.InfoContext(ctx, "ledger_settle_retry_recovered", "order_id", orderID, "attempt", attempt)
	return true
}

func bumpRetryMeta(ctx context.Context, pool *pgxpool.Pool, orderID string, attempt int, errMsg string) {
	patch := map[string]any{
		"settle_retry_attempts":     attempt,
		"settle_retry_last_error":   truncateForDB(errMsg, 480),
		"settle_retry_last_seen_at": time.Now().UTC().Format(time.RFC3339),
	}
	patchBytes, _ := json.Marshal(patch)
	if _, err := pool.Exec(ctx, `
		UPDATE payment_withdrawals SET
			metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb,
			updated_at = now()
		WHERE provider = 'passimpay' AND provider_order_id = $1
	`, orderID, patchBytes); err != nil {
		slog.ErrorContext(ctx, "ledger_settle_retry_meta_update", "order_id", orderID, "err", err)
	}
}

// alertStuckWithdrawal raises a reconciliation alert for a withdrawal that
// has burned through every auto-retry. Beyond this point a human must inspect
// PassimPay to determine whether the payout actually shipped on-chain.
func alertStuckWithdrawal(ctx context.Context, pool *pgxpool.Pool, userID, wdID, orderID string, amountMinor int64, ccy string, attempts int) {
	details, _ := json.Marshal(map[string]any{
		"withdrawal_id":  wdID,
		"order_id":       orderID,
		"amount_minor":   amountMinor,
		"currency":       ccy,
		"attempts":       attempts,
		"recommendation": "verify on PassimPay dashboard whether payout shipped, then drive ledger finalize or compensate the user",
	})
	// Mark the row escalated so we don't keep re-alerting the same one.
	if _, err := pool.Exec(ctx, `
		UPDATE payment_withdrawals SET
			status = 'LEDGER_SETTLE_ESCALATED',
			metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('settle_retry_escalated_at', to_jsonb(now())),
			updated_at = now()
		WHERE provider = 'passimpay' AND provider_order_id = $1 AND status = 'LEDGER_SETTLE_FAILED'
	`, orderID); err != nil {
		slog.ErrorContext(ctx, "ledger_settle_escalation_status", "order_id", orderID, "err", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
		VALUES ('withdrawal_ledger_settle_escalated', NULLIF($1,'')::uuid, 'payment_withdrawals', $2, COALESCE($3::jsonb, '{}'::jsonb))
	`, userID, wdID, details); err != nil {
		slog.ErrorContext(ctx, "ledger_settle_escalation_alert", "order_id", orderID, "err", err)
	}
}
