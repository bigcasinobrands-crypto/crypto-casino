package adminops

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/wallet"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (h *Handler) ListPendingWithdrawals(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT w.withdrawal_id::text, w.user_id::text, COALESCE(u.email,''), w.amount_minor,
		       COALESCE(w.currency,''), w.status, w.created_at,
		       COALESCE(w.admin_decision,''), w.reviewed_at
		FROM payment_withdrawals w
		LEFT JOIN users u ON u.id = w.user_id
		WHERE w.provider = 'passimpay'
		  AND w.status IN ('LEDGER_LOCKED','SUBMITTED_TO_PROVIDER')
		ORDER BY w.created_at ASC
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	var list []map[string]any
	for rows.Next() {
		var id, uid, email, ccy, status, decision string
		var amount int64
		var ct time.Time
		var reviewedAt *time.Time
		if err := rows.Scan(&id, &uid, &email, &amount, &ccy, &status, &ct, &decision, &reviewedAt); err != nil {
			continue
		}
		row := map[string]any{
			"id": id, "user_id": uid, "email": email,
			"amount_minor": amount, "currency": ccy, "status": status,
			"created_at": ct.UTC().Format(time.RFC3339),
		}
		if decision != "" {
			row["admin_decision"] = decision
		}
		if reviewedAt != nil {
			row["reviewed_at"] = reviewedAt.UTC().Format(time.RFC3339)
		}
		list = append(list, row)
	}
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, map[string]any{"pending": list, "count": len(list)})
}

// ApproveWithdrawal — post-submission staff review. Marks the withdrawal as
// reviewed_at + admin_decision='approved'. Approval is one-way: a withdrawal
// approved by staff cannot be rejected afterwards. The PassimPay state machine
// continues independently (the withdrawal was already submitted at request
// time); approval here is a compliance/audit signal, not an external trigger.
func (h *Handler) ApproveWithdrawal(w http.ResponseWriter, r *http.Request) {
	wdID := chi.URLParam(r, "id")
	if wdID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing withdrawal id")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	ctx := r.Context()
	metaPatch := map[string]any{"admin_decision": "approved", "reason": body.Reason, "reviewed_by_staff_user_id": staffID}
	metaBytes, _ := json.Marshal(metaPatch)
	tag, err := h.Pool.Exec(ctx, `
		UPDATE payment_withdrawals SET
			admin_decision = 'approved',
			reviewed_at = now(),
			reviewed_by_staff_user_id = $3::uuid,
			metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb,
			updated_at = now()
		WHERE provider = 'passimpay'
		  AND withdrawal_id::text = $1
		  AND status IN ('LEDGER_LOCKED','SUBMITTED_TO_PROVIDER')
		  AND (admin_decision IS NULL OR admin_decision = 'approved')
	`, wdID, metaBytes, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusConflict, "withdrawal_locked", "withdrawal not found, already finalized, or previously rejected")
		return
	}

	auditMeta, _ := json.Marshal(map[string]any{"reason": body.Reason})
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'withdrawal.approve', 'payment_withdrawals', $2, $3)
	`, staffID, wdID, auditMeta); err != nil {
		slog.ErrorContext(ctx, "admin_audit_log_insert_failed", "action", "withdrawal.approve", "wd_id", wdID, "err", err)
	}
	_ = adminapi.ConsumeStepUpForAction(ctx, h.Pool, "withdrawal.approve")

	writeJSON(w, map[string]any{"ok": true, "withdrawal_id": wdID, "admin_decision": "approved"})
}

// RejectWithdrawal — staff cancels a withdrawal that has not yet been submitted to
// the provider. Reject only works on LEDGER_LOCKED rows (provider call has not
// yet been made or has not finalized in the ledger). Reject performs:
//
//  1. mark the row reviewed_at + admin_decision='rejected'
//  2. unlock the ledger lock (cash credit + pending_withdrawal debit)
//  3. set status to 'REJECTED_BY_ADMIN'
//
// Reject is blocked once the row is SUBMITTED_TO_PROVIDER — at that point only
// PassimPay's outbound flow can reverse it, and any refund must be tracked
// separately (E-2 deposit-reversal-style endpoint).
func (h *Handler) RejectWithdrawal(w http.ResponseWriter, r *http.Request) {
	wdID := chi.URLParam(r, "id")
	if wdID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing withdrawal id")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Reason) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "reason is required")
		return
	}

	ctx := r.Context()
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "tx begin failed")
		return
	}
	defer tx.Rollback(ctx)

	var (
		userID         string
		ccy            string
		amountMinor    int64
		status         string
		decision       *string
		providerOrder  string
		ledgerLockIdem string
	)
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, COALESCE(currency,''), amount_minor, status,
		       admin_decision, COALESCE(provider_order_id,''), COALESCE(ledger_lock_idem_suffix,'')
		FROM payment_withdrawals
		WHERE provider = 'passimpay' AND withdrawal_id::text = $1
		FOR UPDATE
	`, wdID).Scan(&userID, &ccy, &amountMinor, &status, &decision, &providerOrder, &ledgerLockIdem)
	if errors.Is(err, pgx.ErrNoRows) {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "withdrawal not found")
		return
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	if status != "LEDGER_LOCKED" {
		adminapi.WriteError(w, http.StatusConflict, "withdrawal_already_submitted", "cannot reject — withdrawal is "+status+" (only LEDGER_LOCKED rows are reversible by admin)")
		return
	}
	if decision != nil && *decision == "approved" {
		adminapi.WriteError(w, http.StatusConflict, "withdrawal_already_approved", "cannot reject a withdrawal that has been approved by staff")
		return
	}

	metaPatch := map[string]any{"admin_decision": "rejected", "reason": body.Reason, "reviewed_by_staff_user_id": staffID}
	metaBytes, _ := json.Marshal(metaPatch)
	if _, err := tx.Exec(ctx, `
		UPDATE payment_withdrawals SET
			status = 'REJECTED_BY_ADMIN',
			admin_decision = 'rejected',
			reviewed_at = now(),
			reviewed_by_staff_user_id = $3::uuid,
			metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb,
			updated_at = now()
		WHERE provider = 'passimpay' AND withdrawal_id::text = $1
	`, wdID, metaBytes, staffID); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "commit failed")
		return
	}

	idemForUnlock := ledgerLockIdem
	if idemForUnlock == "" {
		idemForUnlock = providerOrder
	}
	if err := wallet.PassimpayUnlockFundsErr(ctx, h.Pool, userID, ccy, amountMinor, idemForUnlock, wdID); err != nil {
		slog.ErrorContext(ctx, "withdrawal_reject_unlock_failed", "wd_id", wdID, "user_id", userID, "err", err)
		insertReconciliationAlert(ctx, h.Pool, "withdrawal_reject_unlock_failed", userID, "payment_withdrawals", wdID, map[string]any{
			"amount_minor": amountMinor,
			"currency":     ccy,
			"err":          err.Error(),
		})
		adminapi.WriteError(w, http.StatusInternalServerError, "ledger_unlock_failed", "withdrawal marked rejected but ledger unlock failed; ops alerted")
		return
	}

	auditMeta, _ := json.Marshal(map[string]any{"reason": body.Reason, "amount_minor": amountMinor, "currency": ccy})
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'withdrawal.reject', 'payment_withdrawals', $2, $3)
	`, staffID, wdID, auditMeta); err != nil {
		slog.ErrorContext(ctx, "admin_audit_log_insert_failed", "action", "withdrawal.reject", "wd_id", wdID, "err", err)
	}
	_ = adminapi.ConsumeStepUpForAction(ctx, h.Pool, "withdrawal.reject")

	writeJSON(w, map[string]any{"ok": true, "withdrawal_id": wdID, "admin_decision": "rejected", "status": "REJECTED_BY_ADMIN"})
}

// insertReconciliationAlert is a best-effort writer for the reconciliation_alerts
// table — used when a high-priority operational invariant fails (e.g. ledger
// unlock during a withdrawal reject). Never returns an error to its caller; we
// log instead because the primary action has already been taken.
func insertReconciliationAlert(ctx context.Context, pool *pgxpool.Pool, kind, userID, refType, refID string, details map[string]any) {
	detailsBytes, _ := json.Marshal(details)
	if _, err := pool.Exec(ctx, `
		INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
	`, kind, userID, refType, refID, detailsBytes); err != nil {
		slog.ErrorContext(ctx, "reconciliation_alert_insert_failed", "kind", kind, "ref_id", refID, "err", err)
	}
}
