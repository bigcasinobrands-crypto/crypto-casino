package adminops

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type hardDeletePlayerBody struct {
	ConfirmEmail string `json:"confirm_email"`
}

// HardDeletePlayer removes the player row from the database (superadmin only).
// Body must include confirm_email matching the account email exactly (trimmed).
func (h *Handler) HardDeletePlayer(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	staffID, ok := adminapi.StaffIDFromContext(ctx)
	if !ok || strings.TrimSpace(staffID) == "" {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	idStr := strings.TrimSpace(chi.URLParam(r, "id"))
	if idStr == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	uid, err := uuid.Parse(idStr)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid user id")
		return
	}

	var body hardDeletePlayerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	wantConfirm := strings.TrimSpace(body.ConfirmEmail)
	if wantConfirm == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "confirm_email_required", "confirm_email required")
		return
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "transaction failed")
		return
	}
	defer tx.Rollback(ctx)

	var email string
	err = tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1 FOR UPDATE`, uid).Scan(&email)
	if errors.Is(err, pgx.ErrNoRows) {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if err != nil {
		slog.ErrorContext(ctx, "player_hard_delete_lookup_failed", "err", err, "user_id", uid)
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "lookup failed")
		return
	}
	if wantConfirm != strings.TrimSpace(email) {
		adminapi.WriteError(w, http.StatusBadRequest, "confirm_email_mismatch", "confirm_email does not match this player")
		return
	}

	if err := HardDeletePlayerTx(ctx, tx, uid); err != nil {
		slog.ErrorContext(ctx, "player_hard_delete_tx_failed", "err", err, "user_id", uid)
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "could not delete player")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		slog.ErrorContext(ctx, "player_hard_delete_commit_failed", "err", err, "user_id", uid)
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "commit failed")
		return
	}

	meta, _ := json.Marshal(map[string]any{"user_id": uid.String(), "email": email})
	h.auditExec(ctx, "player.hard_delete", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'player.hard_delete', 'users', $2, $3)
	`, staffID, uid.String(), meta)

	writeJSON(w, map[string]any{"ok": true})
}
