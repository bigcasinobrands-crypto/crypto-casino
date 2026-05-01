package adminops

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/passhash"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) ListStaffUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, email, role, COALESCE(mfa_webauthn_enforced, false), created_at FROM staff_users ORDER BY created_at ASC
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, email, role string
		var mfa bool
		var ct time.Time
		if err := rows.Scan(&id, &email, &role, &mfa, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "email": email, "role": role, "mfa_webauthn_enforced": mfa, "created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"staff": list})
}

type createStaffBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *Handler) CreateStaffUser(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body createStaffBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" || len(body.Password) < 8 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "email and password (min 8) required")
		return
	}
	role := strings.TrimSpace(body.Role)
	if role != "admin" && role != "support" && role != "superadmin" {
		role = "admin"
	}
	hashStr, err := passhash.Hash(body.Password)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "hash_error", "cannot hash password")
		return
	}
	var id string
	err = h.Pool.QueryRow(r.Context(), `
		INSERT INTO staff_users (email, password_hash, role) VALUES ($1, $2, $3)
		RETURNING id::text
	`, email, hashStr, role).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusConflict, "duplicate", "email may already exist")
		return
	}
	meta, _ := json.Marshal(map[string]any{"new_staff_id": id, "email": email, "role": role})
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'staff.create', 'staff_users', $2)
	`, staffID, meta)
	writeJSON(w, map[string]any{"id": id, "email": email, "role": role})
}

type patchStaffBody struct {
	Role                 *string `json:"role"`
	MfaWebauthnEnforced *bool   `json:"mfa_webauthn_enforced"`
}

func (h *Handler) PatchStaffUser(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	target := strings.TrimSpace(chi.URLParam(r, "id"))
	if target == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	var body patchStaffBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if body.Role == nil && body.MfaWebauthnEnforced == nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "role and/or mfa_webauthn_enforced required")
		return
	}
	if body.Role != nil {
		role := strings.TrimSpace(*body.Role)
		if role != "admin" && role != "support" && role != "superadmin" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_role", "role must be admin, support, or superadmin")
			return
		}
		tag, err := h.Pool.Exec(r.Context(), `UPDATE staff_users SET role = $1 WHERE id = $2::uuid`, role, target)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
			return
		}
		if tag.RowsAffected() == 0 {
			adminapi.WriteError(w, http.StatusNotFound, "not_found", "staff not found")
			return
		}
		meta, _ := json.Marshal(map[string]any{"staff_id": target, "role": role})
		_, _ = h.Pool.Exec(r.Context(), `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'staff.patch_role', 'staff_users', $2)
		`, staffID, meta)
	}
	if body.MfaWebauthnEnforced != nil {
		tag, err := h.Pool.Exec(r.Context(), `UPDATE staff_users SET mfa_webauthn_enforced = $1 WHERE id = $2::uuid`, *body.MfaWebauthnEnforced, target)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
			return
		}
		if tag.RowsAffected() == 0 {
			adminapi.WriteError(w, http.StatusNotFound, "not_found", "staff not found")
			return
		}
		meta, _ := json.Marshal(map[string]any{"staff_id": target, "mfa_webauthn_enforced": *body.MfaWebauthnEnforced})
		_, _ = h.Pool.Exec(r.Context(), `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'staff.patch_mfa', 'staff_users', $2)
		`, staffID, meta)
	}
	writeJSON(w, map[string]any{"ok": true})
}
