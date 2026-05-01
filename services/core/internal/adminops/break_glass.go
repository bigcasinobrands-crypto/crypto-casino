package adminops

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

const (
	breakGlassDefaultTTLMin = 240
	breakGlassMaxTTLMin     = 1440
	breakGlassMinTTLMin     = 5
)

func clampBreakGlassTTLMinutes(v int) int {
	if v <= 0 {
		return breakGlassDefaultTTLMin
	}
	if v < breakGlassMinTTLMin {
		return breakGlassMinTTLMin
	}
	if v > breakGlassMaxTTLMin {
		return breakGlassMaxTTLMin
	}
	return v
}

// ListBreakGlassGrants returns recent break-glass grants (superadmin only via route).
func (h *Handler) ListBreakGlassGrants(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Pool.Query(ctx, `
		SELECT id::text, resource_key, justification,
		       requester_staff_id::text, COALESCE(approver_staff_id::text, ''),
		       status, requested_at, approved_at, expires_at, consumed_at,
		       COALESCE(reject_reason, ''),
		       (expires_at IS NOT NULL AND expires_at < now() AND status = 'approved') AS is_expired
		FROM break_glass_grants
		WHERE requested_at > now() - interval '90 days'
		ORDER BY requested_at DESC
		LIMIT 200
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	var list []map[string]any
	for rows.Next() {
		var id, resKey, just, reqID, apprID, status, reject string
		var reqAt time.Time
		var apprAt, expAt, consAt *time.Time
		var isExpired bool
		if err := rows.Scan(&id, &resKey, &just, &reqID, &apprID, &status, &reqAt, &apprAt, &expAt, &consAt, &reject, &isExpired); err != nil {
			continue
		}
		m := map[string]any{
			"id": id, "resource_key": resKey, "justification": just,
			"requester_staff_id": reqID, "approver_staff_id": apprID,
			"status": status, "reject_reason": reject,
			"requested_at": reqAt.UTC().Format(time.RFC3339),
			"is_expired":   isExpired,
		}
		if apprAt != nil {
			m["approved_at"] = apprAt.UTC().Format(time.RFC3339)
		}
		if expAt != nil {
			m["expires_at"] = expAt.UTC().Format(time.RFC3339)
		}
		if consAt != nil {
			m["consumed_at"] = consAt.UTC().Format(time.RFC3339)
		}
		list = append(list, m)
	}
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, map[string]any{"grants": list})
}

type breakGlassCreateReq struct {
	ResourceKey   string `json:"resource_key"`
	Justification string `json:"justification"`
}

// CreateBreakGlassGrant opens a pending grant (superadmin).
func (h *Handler) CreateBreakGlassGrant(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body breakGlassCreateReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if len(body.ResourceKey) < 1 || len(body.Justification) < 10 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "resource_key and justification (min 10 chars) required")
		return
	}
	ctx := r.Context()
	var id string
	err := h.Pool.QueryRow(ctx, `
		INSERT INTO break_glass_grants (resource_key, justification, requester_staff_id)
		VALUES ($1, $2, $3::uuid)
		RETURNING id::text
	`, body.ResourceKey, body.Justification, staffID).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	meta, _ := json.Marshal(map[string]any{"grant_id": id, "resource_key": body.ResourceKey})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'break_glass.create', 'break_glass_grants', $2, $3)
	`, staffID, id, meta)
	writeJSON(w, map[string]any{"id": id, "status": "pending"})
}

type breakGlassApproveReq struct {
	TTLMinutes int `json:"ttl_minutes"`
}

// ApproveBreakGlassGrant requires a different superadmin than the requester.
func (h *Handler) ApproveBreakGlassGrant(w http.ResponseWriter, r *http.Request) {
	grantID := chi.URLParam(r, "id")
	if grantID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing id")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body breakGlassApproveReq
	_ = json.NewDecoder(r.Body).Decode(&body)
	ttl := clampBreakGlassTTLMinutes(body.TTLMinutes)

	ctx := r.Context()
	var requester string
	err := h.Pool.QueryRow(ctx, `
		SELECT requester_staff_id::text FROM break_glass_grants WHERE id = $1::uuid AND status = 'pending'
	`, grantID).Scan(&requester)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "pending grant not found")
		return
	}
	if requester == staffID {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "approver must differ from requester")
		return
	}

	tag, err := h.Pool.Exec(ctx, `
		UPDATE break_glass_grants SET
			status = 'approved',
			approver_staff_id = $2::uuid,
			approved_at = now(),
			expires_at = now() + ($3::bigint * interval '1 minute')
		WHERE id = $1::uuid AND status = 'pending'
	`, grantID, staffID, ttl)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusConflict, "conflict", "grant no longer pending")
		return
	}
	meta, _ := json.Marshal(map[string]any{"ttl_minutes": ttl})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'break_glass.approve', 'break_glass_grants', $2, $3)
	`, staffID, grantID, meta)
	writeJSON(w, map[string]any{"ok": true, "expires_in_minutes": ttl})
}

type breakGlassRejectReq struct {
	Reason string `json:"reason"`
}

// RejectBreakGlassGrant rejects a pending grant.
func (h *Handler) RejectBreakGlassGrant(w http.ResponseWriter, r *http.Request) {
	grantID := chi.URLParam(r, "id")
	if grantID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing id")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body breakGlassRejectReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Reason) < 3 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "reason required")
		return
	}
	ctx := r.Context()
	tag, err := h.Pool.Exec(ctx, `
		UPDATE break_glass_grants SET
			status = 'rejected',
			approver_staff_id = $2::uuid,
			reject_reason = $3,
			approved_at = now()
		WHERE id = $1::uuid AND status = 'pending'
	`, grantID, staffID, body.Reason)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "pending grant not found")
		return
	}
	meta, _ := json.Marshal(map[string]any{"reason": body.Reason})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'break_glass.reject', 'break_glass_grants', $2, $3)
	`, staffID, grantID, meta)
	writeJSON(w, map[string]any{"ok": true})
}

type breakGlassConsumeReq struct {
	Note string `json:"note"`
}

// ConsumeBreakGlassGrant marks an approved, non-expired grant as consumed.
func (h *Handler) ConsumeBreakGlassGrant(w http.ResponseWriter, r *http.Request) {
	grantID := chi.URLParam(r, "id")
	if grantID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing id")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body breakGlassConsumeReq
	_ = json.NewDecoder(r.Body).Decode(&body)

	ctx := r.Context()
	tag, err := h.Pool.Exec(ctx, `
		UPDATE break_glass_grants SET
			status = 'consumed',
			consumed_at = now()
		WHERE id = $1::uuid
		  AND status = 'approved'
		  AND consumed_at IS NULL
		  AND expires_at > now()
	`, grantID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_state", "grant missing, expired, or already consumed")
		return
	}
	meta, _ := json.Marshal(map[string]any{"note": body.Note})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'break_glass.consume', 'break_glass_grants', $2, $3)
	`, staffID, grantID, meta)
	writeJSON(w, map[string]any{"ok": true})
}
