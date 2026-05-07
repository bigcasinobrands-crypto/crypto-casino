package compliance

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AML monitoring helpers.
//
// Today the casino does not run a full transaction-monitoring engine. We
// instead emit reconciliation_alerts on a few well-known patterns so a human
// operator can investigate. The thresholds are configurable so they can be
// tuned per-jurisdiction without code changes:
//
//   - aml_large_deposit:    single deposit >= KYCLargeDepositThresholdCents
//   - aml_large_withdrawal: single withdrawal >= KYCLargeWithdrawalThresholdCents
//   - aml_rapid_withdrawal: withdrawal within 24h of first deposit
//   - aml_high_velocity_deposits: >= 5 deposits in last 24h
//
// All helpers are non-blocking: they record the alert and return. Failure to
// record an alert is logged but never bubbles up to the player flow, because
// "we couldn't write a SAR breadcrumb" should not stop a legitimate payment.

// EmitAMLLargeDepositAlert records an alert when an incoming deposit equals
// or exceeds thresholdMinor. Pass thresholdMinor=0 to disable.
func EmitAMLLargeDepositAlert(ctx context.Context, pool *pgxpool.Pool, userID, currency, providerOrderID string, amountMinor, thresholdMinor int64) {
	if pool == nil || thresholdMinor <= 0 || amountMinor < thresholdMinor {
		return
	}
	details := map[string]any{
		"user_id":           userID,
		"amount_minor":      amountMinor,
		"currency":          strings.ToUpper(currency),
		"threshold_minor":   thresholdMinor,
		"provider_order_id": providerOrderID,
	}
	insertAlert(ctx, pool, "aml_large_deposit", userID, "payment_deposit_intent", providerOrderID, details)
}

// EmitAMLLargeWithdrawalAlert records an alert when an outgoing withdrawal
// equals or exceeds thresholdMinor. Threshold is in USD cents.
func EmitAMLLargeWithdrawalAlert(ctx context.Context, pool *pgxpool.Pool, userID, currency, withdrawalID string, amountMinor, thresholdMinor int64) {
	if pool == nil || thresholdMinor <= 0 || amountMinor < thresholdMinor {
		return
	}
	details := map[string]any{
		"user_id":         userID,
		"amount_minor":    amountMinor,
		"currency":        strings.ToUpper(currency),
		"threshold_minor": thresholdMinor,
		"withdrawal_id":   withdrawalID,
	}
	insertAlert(ctx, pool, "aml_large_withdrawal", userID, "payment_withdrawal", withdrawalID, details)
}

// EmitAMLRapidWithdrawalAlert raises an alert if the player is withdrawing
// within hoursWindow of their first ever successful deposit. Defaults to 24h.
// This is a classic structuring pattern.
func EmitAMLRapidWithdrawalAlert(ctx context.Context, pool *pgxpool.Pool, userID, withdrawalID string, hoursWindow int) {
	if pool == nil {
		return
	}
	if hoursWindow <= 0 {
		hoursWindow = 24
	}
	var firstDeposit *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT MIN(created_at) FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type = 'deposit.credit' AND amount_minor > 0
	`, userID).Scan(&firstDeposit); err != nil {
		return
	}
	if firstDeposit == nil {
		return
	}
	if time.Since(*firstDeposit) > time.Duration(hoursWindow)*time.Hour {
		return
	}
	details := map[string]any{
		"user_id":            userID,
		"first_deposit_at":   firstDeposit.UTC().Format(time.RFC3339),
		"hours_since_first":  time.Since(*firstDeposit).Hours(),
		"hours_window":       hoursWindow,
		"withdrawal_id":      withdrawalID,
	}
	insertAlert(ctx, pool, "aml_rapid_withdrawal", userID, "payment_withdrawal", withdrawalID, details)
}

// EmitAMLHighVelocityDepositsAlert raises an alert if the player has made
// >= countThreshold deposits in the last hoursWindow. Helps surface possible
// smurfing or stolen-card runs.
func EmitAMLHighVelocityDepositsAlert(ctx context.Context, pool *pgxpool.Pool, userID, providerOrderID string, hoursWindow, countThreshold int) {
	if pool == nil || countThreshold <= 0 {
		return
	}
	if hoursWindow <= 0 {
		hoursWindow = 24
	}
	var n int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND entry_type = 'deposit.credit'
		  AND amount_minor > 0
		  AND created_at >= now() - ($2::int || ' hours')::interval
	`, userID, hoursWindow).Scan(&n); err != nil {
		return
	}
	if n < countThreshold {
		return
	}
	details := map[string]any{
		"user_id":            userID,
		"deposit_count":      n,
		"hours_window":       hoursWindow,
		"count_threshold":    countThreshold,
		"provider_order_id":  providerOrderID,
	}
	insertAlert(ctx, pool, "aml_high_velocity_deposits", userID, "payment_deposit_intent", providerOrderID, details)
}

// insertAlert writes a row to reconciliation_alerts for an AML kind. Errors
// are logged via slog but never propagated, because failing to write a
// breadcrumb should not roll back the underlying payment flow.
func insertAlert(ctx context.Context, pool *pgxpool.Pool, kind, userID, refType, refID string, details map[string]any) {
	body, _ := json.Marshal(details)
	if _, err := pool.Exec(ctx, `
		INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
	`, kind, userID, refType, refID, body); err != nil {
		slog.ErrorContext(ctx, "aml_alert_insert_failed",
			"kind", kind, "user_id", userID, "ref_id", refID, "err", err)
	}
}
