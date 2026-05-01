package adminops

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ListApprovalRequests returns recent admin approval requests (4-eyes), optionally filtered by status.
func (h *Handler) ListApprovalRequests(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	switch status {
	case "pending", "approved", "rejected", "cancelled", "all", "":
	default:
		status = ""
	}
	ctx := r.Context()

	base := `
		SELECT id::text, requester_staff_id::text, resource_type,
		       before_state, after_state, status,
		       COALESCE(approver_staff_id::text, ''),
		       COALESCE(comment, ''),
		       created_at, resolved_at
		FROM admin_approval_requests
		WHERE created_at > now() - interval '180 days'
	`
	args := []any{}
	if status != "" && status != "all" {
		base += ` AND status = $1`
		args = append(args, status)
	}
	base += ` ORDER BY created_at DESC LIMIT 200`

	var rows pgx.Rows
	var err error
	if len(args) > 0 {
		rows, err = h.Pool.Query(ctx, base, args...)
	} else {
		rows, err = h.Pool.Query(ctx, base)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	list, err := scanApprovalRows(rows)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "scan failed")
		return
	}
	writeJSON(w, map[string]any{"requests": list})
}

func scanApprovalRows(rows pgx.Rows) ([]map[string]any, error) {
	var list []map[string]any
	for rows.Next() {
		var id, reqID, resType, st, apprID, comment string
		var beforeB, afterB []byte
		var created time.Time
		var resolved *time.Time
		if err := rows.Scan(&id, &reqID, &resType, &beforeB, &afterB, &st, &apprID, &comment, &created, &resolved); err != nil {
			return nil, err
		}
		m := map[string]any{
			"id": id, "requester_staff_id": reqID, "resource_type": resType,
			"status": st, "approver_staff_id": apprID, "comment": comment,
			"created_at": created.UTC().Format(time.RFC3339),
		}
		m["before_state"] = jsonRawToAny(beforeB)
		m["after_state"] = jsonRawToAny(afterB)
		if resolved != nil {
			m["resolved_at"] = resolved.UTC().Format(time.RFC3339)
		}
		list = append(list, m)
	}
	if list == nil {
		list = []map[string]any{}
	}
	return list, nil
}

func jsonRawToAny(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil
	}
	return v
}

// GetApprovalRequest returns one request by id.
func (h *Handler) GetApprovalRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing id")
		return
	}
	ctx := r.Context()
	row := h.Pool.QueryRow(ctx, `
		SELECT id::text, requester_staff_id::text, resource_type,
		       before_state, after_state, status,
		       COALESCE(approver_staff_id::text, ''),
		       COALESCE(comment, ''),
		       created_at, resolved_at
		FROM admin_approval_requests WHERE id = $1::uuid
	`, id)
	var rid, reqID, resType, st, apprID, comment string
	var beforeB, afterB []byte
	var created time.Time
	var resolved *time.Time
	if err := row.Scan(&rid, &reqID, &resType, &beforeB, &afterB, &st, &apprID, &comment, &created, &resolved); err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "request not found")
		return
	}
	m := map[string]any{
		"id": rid, "requester_staff_id": reqID, "resource_type": resType,
		"status": st, "approver_staff_id": apprID, "comment": comment,
		"created_at": created.UTC().Format(time.RFC3339),
		"before_state": jsonRawToAny(beforeB),
		"after_state":  jsonRawToAny(afterB),
	}
	if resolved != nil {
		m["resolved_at"] = resolved.UTC().Format(time.RFC3339)
	}
	writeJSON(w, m)
}

type approvalCreateReq struct {
	ResourceType string `json:"resource_type"`
	BeforeState  any    `json:"before_state"`
	AfterState   any    `json:"after_state"`
}

// CreateApprovalRequest opens a pending 4-eyes request.
func (h *Handler) CreateApprovalRequest(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body approvalCreateReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if len(body.ResourceType) < 2 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "resource_type required")
		return
	}
	beforeB, err := json.Marshal(body.BeforeState)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "before_state not JSON-serializable")
		return
	}
	afterB, err := json.Marshal(body.AfterState)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "after_state not JSON-serializable")
		return
	}
	ctx := r.Context()
	var newID string
	err = h.Pool.QueryRow(ctx, `
		INSERT INTO admin_approval_requests (requester_staff_id, resource_type, before_state, after_state)
		VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb)
		RETURNING id::text
	`, staffID, body.ResourceType, beforeB, afterB).Scan(&newID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	meta, _ := json.Marshal(map[string]any{"resource_type": body.ResourceType})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'approval_request.create', 'admin_approval_requests', $2, $3)
	`, staffID, newID, meta)
	writeJSON(w, map[string]any{"id": newID, "status": "pending"})
}

type approvalResolveReq struct {
	Comment string `json:"comment"`
}

// ApproveApprovalRequest approves a pending request (superadmin only; cannot approve own request).
func (h *Handler) ApproveApprovalRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing id")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body approvalResolveReq
	_ = json.NewDecoder(r.Body).Decode(&body)

	ctx := r.Context()
	var requester string
	err := h.Pool.QueryRow(ctx, `
		SELECT requester_staff_id::text FROM admin_approval_requests
		WHERE id = $1::uuid AND status = 'pending'
	`, id).Scan(&requester)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "pending request not found")
		return
	}
	if requester == staffID {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "approver must differ from requester")
		return
	}

	tag, err := h.Pool.Exec(ctx, `
		UPDATE admin_approval_requests SET
			status = 'approved',
			approver_staff_id = $2::uuid,
			comment = NULLIF(trim($3), ''),
			resolved_at = now()
		WHERE id = $1::uuid AND status = 'pending'
	`, id, staffID, body.Comment)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusConflict, "conflict", "request no longer pending")
		return
	}
	meta, _ := json.Marshal(map[string]any{"comment": body.Comment})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'approval_request.approve', 'admin_approval_requests', $2, $3)
	`, staffID, id, meta)
	writeJSON(w, map[string]any{"ok": true})
}

// RejectApprovalRequest rejects a pending request (superadmin only).
func (h *Handler) RejectApprovalRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "missing id")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body approvalResolveReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Comment) < 3 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "comment required (min 3 chars)")
		return
	}
	ctx := r.Context()
	var requester string
	err := h.Pool.QueryRow(ctx, `
		SELECT requester_staff_id::text FROM admin_approval_requests
		WHERE id = $1::uuid AND status = 'pending'
	`, id).Scan(&requester)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "pending request not found")
		return
	}
	if requester == staffID {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "rejecting party must differ from requester")
		return
	}
	tag, err := h.Pool.Exec(ctx, `
		UPDATE admin_approval_requests SET
			status = 'rejected',
			approver_staff_id = $2::uuid,
			comment = $3,
			resolved_at = now()
		WHERE id = $1::uuid AND status = 'pending'
	`, id, staffID, body.Comment)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusConflict, "conflict", "request no longer pending")
		return
	}
	meta, _ := json.Marshal(map[string]any{"comment": body.Comment})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'approval_request.reject', 'admin_approval_requests', $2, $3)
	`, staffID, id, meta)
	writeJSON(w, map[string]any{"ok": true})
}
