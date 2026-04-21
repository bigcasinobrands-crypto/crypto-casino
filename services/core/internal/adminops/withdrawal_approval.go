package adminops

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) ListPendingWithdrawals(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT w.id, w.user_id::text, COALESCE(u.email,''), w.amount_minor,
		       COALESCE(w.currency,''), w.status, w.created_at
		FROM fystack_withdrawals w
		LEFT JOIN users u ON u.id = w.user_id
		WHERE w.status IN ('pending','pending_approval')
		   OR w.amount_minor > 100000
		ORDER BY w.created_at ASC
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	var list []map[string]any
	for rows.Next() {
		var id, uid, email, ccy, status string
		var amount int64
		var ct time.Time
		if err := rows.Scan(&id, &uid, &email, &amount, &ccy, &status, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "user_id": uid, "email": email,
			"amount_minor": amount, "currency": ccy, "status": status,
			"created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, map[string]any{"pending": list, "count": len(list)})
}

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
	tag, err := h.Pool.Exec(ctx, `
		UPDATE fystack_withdrawals SET status = 'approved'
		WHERE id = $1 AND status IN ('pending','pending_approval')
	`, wdID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "withdrawal not found or already processed")
		return
	}

	meta, _ := json.Marshal(map[string]any{"reason": body.Reason})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'withdrawal.approve', 'fystack_withdrawals', $2, $3)
	`, staffID, wdID, meta)

	writeJSON(w, map[string]any{"ok": true})
}

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
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Reason == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "reason is required")
		return
	}

	ctx := r.Context()
	tag, err := h.Pool.Exec(ctx, `
		UPDATE fystack_withdrawals SET status = 'rejected'
		WHERE id = $1 AND status IN ('pending','pending_approval')
	`, wdID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "withdrawal not found or already processed")
		return
	}

	meta, _ := json.Marshal(map[string]any{"reason": body.Reason})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'withdrawal.reject', 'fystack_withdrawals', $2, $3)
	`, staffID, wdID, meta)

	writeJSON(w, map[string]any{"ok": true})
}
