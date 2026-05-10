package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

// PatchPlayerEmail2FA is superadmin-only (route). Body: { "action": "force_disable" | "clear_admin_lock" }.
func (h *Handler) PatchPlayerEmail2FA(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	uid := strings.TrimSpace(chi.URLParam(r, "id"))
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	action := strings.ToLower(strings.TrimSpace(body.Action))
	switch action {
	case "force_disable":
		tx, err := h.Pool.Begin(r.Context())
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "transaction failed")
			return
		}
		defer tx.Rollback(r.Context())
		tag, err := tx.Exec(r.Context(), `
			UPDATE users SET email_2fa_enabled = false, email_2fa_admin_locked = true
			WHERE id = $1::uuid
		`, uid)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
			return
		}
		if tag.RowsAffected() == 0 {
			adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		_, _ = tx.Exec(r.Context(), `DELETE FROM player_email_otp_challenges WHERE user_id = $1::uuid`, uid)
		if err := tx.Commit(r.Context()); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "commit failed")
			return
		}
	case "clear_admin_lock":
		tag, err := h.Pool.Exec(r.Context(), `
			UPDATE users SET email_2fa_admin_locked = false WHERE id = $1::uuid
		`, uid)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
			return
		}
		if tag.RowsAffected() == 0 {
			adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
	default:
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_action", `action must be "force_disable" or "clear_admin_lock"`)
		return
	}

	meta, _ := json.Marshal(map[string]any{"user_id": uid, "action": action})
	h.auditExec(r.Context(), "user.email_2fa_patch", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'user.email_2fa_patch', 'player', $2)
	`, staffID, meta)

	writeJSON(w, map[string]any{"ok": true})
}
