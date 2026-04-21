package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

// PatchUserCompliance sets or clears self-exclusion and account closure (superadmin, audited).
// For each field, send JSON null to leave unchanged, JSON string (RFC3339) to set, or JSON empty string "" to clear.
func (h *Handler) PatchUserCompliance(w http.ResponseWriter, r *http.Request) {
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
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	reason := ""
	if b, ok := raw["reason"]; ok && string(b) != "null" {
		var s string
		_ = json.Unmarshal(b, &s)
		reason = strings.TrimSpace(s)
	}

	var setParts []string
	var args []any
	argN := 1

	if b, ok := raw["self_excluded_until"]; ok {
		if string(b) == "null" {
			// omit — no change
		} else {
			var s string
			if err := json.Unmarshal(b, &s); err != nil {
				adminapi.WriteError(w, http.StatusBadRequest, "invalid_field", "self_excluded_until invalid")
				return
			}
			s = strings.TrimSpace(s)
			if s == "" {
				setParts = append(setParts, `self_excluded_until = $`+strconv.Itoa(argN))
				args = append(args, nil)
				argN++
			} else {
				t, err := time.Parse(time.RFC3339, s)
				if err != nil {
					adminapi.WriteError(w, http.StatusBadRequest, "invalid_date", "self_excluded_until must be RFC3339")
					return
				}
				setParts = append(setParts, `self_excluded_until = $`+strconv.Itoa(argN))
				args = append(args, t)
				argN++
			}
		}
	}

	if b, ok := raw["account_closed_at"]; ok {
		if string(b) == "null" {
			// omit
		} else {
			var s string
			if err := json.Unmarshal(b, &s); err != nil {
				adminapi.WriteError(w, http.StatusBadRequest, "invalid_field", "account_closed_at invalid")
				return
			}
			s = strings.TrimSpace(s)
			if s == "" {
				setParts = append(setParts, `account_closed_at = $`+strconv.Itoa(argN))
				args = append(args, nil)
				argN++
			} else {
				t, err := time.Parse(time.RFC3339, s)
				if err != nil {
					adminapi.WriteError(w, http.StatusBadRequest, "invalid_date", "account_closed_at must be RFC3339")
					return
				}
				setParts = append(setParts, `account_closed_at = $`+strconv.Itoa(argN))
				args = append(args, t)
				argN++
			}
		}
	}

	if len(setParts) == 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "no_fields", "provide self_excluded_until and/or account_closed_at (string, empty string to clear)")
		return
	}
	args = append(args, uid)
	q := `UPDATE users SET ` + strings.Join(setParts, ", ") + ` WHERE id = $` + strconv.Itoa(argN) + `::uuid`
	tag, err := h.Pool.Exec(r.Context(), q, args...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}

	meta, _ := json.Marshal(map[string]any{
		"user_id": uid,
		"patch":   raw,
		"reason":  reason,
	})
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'user.compliance_patch', 'player', $2)
	`, staffID, meta)

	writeJSON(w, map[string]any{"ok": true})
}
