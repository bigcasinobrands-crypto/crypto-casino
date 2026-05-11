package adminops

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// reverseDepositReq is the body of POST /v1/admin/deposits/{id}/reverse.
// The reason is mandatory because reversing a real-money credit is a high-blast
// action and must be auditable. clawback=true (default) writes the actual
// negative ledger leg; passing clawback=false will only mark the intent as
// REVERSED in the deposit table without touching the ledger — used in narrow
// cases where the credit was never actually posted.
type reverseDepositReq struct {
	Reason   string `json:"reason"`
	Clawback *bool  `json:"clawback,omitempty"`
}

// ReverseDeposit handles POST /v1/admin/deposits/{id}/reverse — superadmin only.
//
// Use case:
//   - PassimPay reports a chargeback / deposit reversal weeks after we have
//     already credited the player.
//   - A duplicate deposit credit slipped through for any reason and must be
//     rolled back without leaving the ledger in a half-state.
//
// Mechanics:
//  1. Locate the original deposit row (payment_deposit_intents row keyed by
//     UUID OR by provider_order_id).
//  2. Resolve the original credit ledger row by its idempotency key
//     (`passimpay:deposit:credit:<provider_order_id>`).
//  3. Inside ONE transaction:
//     a. ApplyDebit on player's cash pocket with EntryTypeDepositReversal,
//     keyed by `deposit.reversal:<provider_order_id>` so retries are no-ops.
//     b. Mirror leg on house clearing-deposit pocket so the double-entry
//     balance stays clean (player liability ↓, house custody ↓).
//     c. Mark payment_deposit_intents row REVERSED.
//     d. Insert reconciliation_alerts row so finance/risk see a high-priority
//     record of the reversal.
//     e. Insert admin_audit_log row.
//
// Authorization: route is gated by superadmin role at the router (see
// handlers.go). We additionally read the staff id from context to log it on
// the audit row and admin_audit_log meta. If staff id is missing for any
// reason we refuse the action — we will not write a real-money debit without
// an actor.
func (h *Handler) ReverseDeposit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_request", "deposit id required")
		return
	}
	staffID, _ := adminapi.StaffIDFromContext(ctx)
	if strings.TrimSpace(staffID) == "" {
		adminapi.WriteError(w, http.StatusUnauthorized, "no_actor", "missing staff identity")
		return
	}
	var body reverseDepositReq
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	reason := strings.TrimSpace(body.Reason)
	if reason == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "reason_required", "reason is mandatory for deposit reversals")
		return
	}
	clawback := true
	if body.Clawback != nil {
		clawback = *body.Clawback
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "tx_begin_failed", err.Error())
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var (
		intentID, userID, providerOrderID, currency, status string
		creditedMinor                                       int64
		internalCredited                                    int64
		internalLedgerCcy                                   sql.NullString
	)
	err = tx.QueryRow(ctx, `
		SELECT id::text, user_id::text, provider_order_id, currency, status, credited_amount_minor,
			COALESCE(internal_credited_minor, 0),
			internal_ledger_currency
		FROM payment_deposit_intents
		WHERE id::text = $1 OR provider_order_id = $1
		FOR UPDATE
	`, id).Scan(&intentID, &userID, &providerOrderID, &currency, &status, &creditedMinor, &internalCredited, &internalLedgerCcy)
	if errors.Is(err, pgx.ErrNoRows) {
		adminapi.WriteError(w, http.StatusNotFound, "deposit_not_found", "no deposit matches that id")
		return
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "deposit_lookup_failed", err.Error())
		return
	}

	revCcy := strings.ToUpper(strings.TrimSpace(currency))
	revAmt := creditedMinor
	if internalCredited > 0 && internalLedgerCcy.Valid && strings.TrimSpace(internalLedgerCcy.String) != "" {
		revCcy = strings.ToUpper(strings.TrimSpace(internalLedgerCcy.String))
		revAmt = internalCredited
	}

	if strings.EqualFold(status, "REVERSED") {
		// Idempotent for repeated admin clicks.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":            intentID,
			"status":        "REVERSED",
			"already":       true,
			"amount_minor":  revAmt,
			"currency":      revCcy,
		})
		return
	}
	if creditedMinor <= 0 && internalCredited <= 0 {
		adminapi.WriteError(w, http.StatusConflict, "nothing_to_reverse", "deposit has no credited amount")
		return
	}

	ccy := revCcy
	reverseAmt := revAmt

	if clawback {
		// (a) Reverse the player's cash credit. We use ApplyCreditWithPocketTx
		//     with a negative amount instead of ApplyDebitTx so the ledger row
		//     amount_minor field carries the SAME magnitude (negative) as the
		//     original (positive) credit but with EntryTypeDepositReversal —
		//     downstream queries can still group by entry_type to see reversed
		//     volume separately.
		idemPlayer := fmt.Sprintf("deposit.reversal:%s", providerOrderID)
		meta := map[string]any{
			"reason":            reason,
			"actor_staff_id":    staffID,
			"reverses_intent":   intentID,
			"provider_order_id": providerOrderID,
		}
		if _, err := ledger.ApplyCreditWithPocketTx(ctx, tx, userID, ccy, ledger.EntryTypeDepositReversal, idemPlayer, -reverseAmt, ledger.PocketCash, meta); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "reversal_player_leg_failed", err.Error())
			return
		}
		// (b) House mirror leg: the inbound clearing leg posted at deposit
		//     time was a positive house clearing_deposit credit. Reverse it
		//     here with a negative entry under the same entry type so the
		//     fund-segregation report stays balanced.
		idemHouse := fmt.Sprintf("deposit.reversal.clearing:%s", providerOrderID)
		if _, err := ledger.ApplyCreditWithPocketTx(ctx, tx, ledger.HouseUserID(h.Cfg), ccy, ledger.EntryTypeDepositReversal, idemHouse, -reverseAmt, ledger.PocketClearingDeposit, meta); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "reversal_house_leg_failed", err.Error())
			return
		}
	}

	// (c) Mark the intent reversed so future webhooks / admin UI see the state.
	if _, err := tx.Exec(ctx, `
		UPDATE payment_deposit_intents
		SET status = 'REVERSED',
		    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reversed_at', now(), 'reverse_reason', $2::text, 'reversed_by_staff', $3::text),
		    updated_at = now()
		WHERE id::text = $1
	`, intentID, reason, staffID); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "intent_update_failed", err.Error())
		return
	}

	// (d) Reconciliation alert — every reversal must be on the finance radar.
	alertDetails, _ := json.Marshal(map[string]any{
		"intent_id":         intentID,
		"provider_order_id": providerOrderID,
		"user_id":           userID,
		"amount_minor":      reverseAmt,
		"currency":          ccy,
		"reason":            reason,
		"actor_staff_id":    staffID,
		"clawback":          clawback,
	})
	if _, err := tx.Exec(ctx, `
		INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
		VALUES ('deposit_reversal', NULLIF($1,'')::uuid, 'payment_deposit_intent', $2, COALESCE($3::jsonb, '{}'::jsonb))
	`, userID, intentID, alertDetails); err != nil {
		slog.ErrorContext(ctx, "deposit_reversal_alert_insert_failed", "intent", intentID, "err", err)
	}

	// (e) admin_audit_log — same pattern as the other admin handlers.
	auditMeta, _ := json.Marshal(map[string]any{
		"intent_id":      intentID,
		"reason":         reason,
		"amount_minor":   reverseAmt,
		"currency":       ccy,
		"clawback":       clawback,
		"provider_order": providerOrderID,
	})
	if _, err := tx.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'deposits.reverse', 'payment_deposit_intent', $2, $3::jsonb)
	`, staffID, intentID, auditMeta); err != nil {
		slog.ErrorContext(ctx, "admin_audit_log_insert_failed", "action", "deposits.reverse", "err", err)
	}

	if err := tx.Commit(ctx); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "commit_failed", err.Error())
		return
	}

	// SEC-6: consume the step-up assertion that gated this route. Done
	// post-commit so a partial failure during reversal does not eat the
	// staff user's MFA proof — they can re-issue cleanly without a fresh
	// challenge.
	if err := adminapi.ConsumeStepUpForAction(ctx, h.Pool, "deposit.reverse"); err != nil {
		slog.WarnContext(ctx, "step_up_consume_failed", "action", "deposit.reverse", "err", err)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":           intentID,
		"status":       "REVERSED",
		"amount_minor": reverseAmt,
		"currency":     ccy,
		"clawback":     clawback,
	})
}

// ensureContextNotCanceled is a tiny helper we used during early development
// for symmetry with finance_geo_report. Kept in case callers want a quick
// guard before launching long-running aggregations.
func ensureContextNotCanceled(ctx context.Context) error { return ctx.Err() }
