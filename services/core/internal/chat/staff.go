package chat

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MountStaffRoutes registers /v1/admin/chat/* handlers (caller must apply staff auth + RBAC).
func MountStaffRoutes(r chi.Router, hub *Hub, pool *pgxpool.Pool) {
	r.Get("/messages", staffListMessages(pool))
	r.Get("/online", staffOnlineCount(hub))
	r.Get("/mutes", staffListMutes(pool))
	r.Get("/bans", staffListBans(pool))
	r.Get("/blocked-terms", staffListBlockedTerms(pool))
	r.Post("/messages/{msgID}/delete", staffDeleteMessage(hub, pool))
	r.Post("/users/{userID}/mute", staffMuteUser(pool))
	r.Post("/users/{userID}/ban", staffBanUser(hub, pool))
	r.Post("/broadcast", staffBroadcast(hub, pool))
	r.Get("/settings", staffGetSettings(pool))
	r.Patch("/settings", staffPatchSettings(pool))
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/blocked-terms", staffAddBlockedTerm(pool))
	r.With(adminapi.RequireAnyRole("superadmin")).Delete("/blocked-terms/{id}", staffDeleteBlockedTerm(pool))
}

func staffListMessages(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := 200
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		rows, err := pool.Query(r.Context(), `
			SELECT id, user_id::text, username, body, deleted, created_at
			FROM chat_messages ORDER BY id DESC LIMIT $1
		`, limit)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var id int64
			var uid, uname, body string
			var del bool
			var ct time.Time
			if err := rows.Scan(&id, &uid, &uname, &body, &del, &ct); err != nil {
				continue
			}
			list = append(list, map[string]any{
				"id": id, "user_id": uid, "username": uname, "body": body, "deleted": del,
				"created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"messages": list})
	}
}

func staffOnlineCount(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		n := 0
		if hub != nil {
			n = hub.OnlineCount()
		}
		writeStaffJSON(w, map[string]any{"online": n})
	}
}

func staffDeleteMessage(hub *Hub, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		staffID, ok := adminapi.StaffIDFromContext(r.Context())
		if !ok || staffID == "" {
			adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
			return
		}
		msgID, err := strconv.ParseInt(chi.URLParam(r, "msgID"), 10, 64)
		if err != nil || msgID <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad message id")
			return
		}
		var body struct {
			Reason string `json:"reason"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.TrimSpace(body.Reason) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "reason_required", "reason is required")
			return
		}
		if err := softDeleteMessage(r.Context(), pool, msgID, staffID); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "delete failed")
			return
		}
		meta, _ := json.Marshal(map[string]any{"message_id": msgID, "reason": body.Reason})
		_, _ = pool.Exec(r.Context(), `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
			VALUES ($1::uuid, 'chat.delete_message', 'chat_messages', $2, $3::jsonb)
		`, staffID, strconv.FormatInt(msgID, 10), meta)
		if hub != nil {
			env := Envelope{Type: "delete", Data: json.RawMessage(mustMarshal(DeleteData{MessageID: msgID}))}
			data, _ := json.Marshal(env)
			hub.broadcast <- data
		}
		writeStaffJSON(w, map[string]any{"ok": true})
	}
}

func staffMuteUser(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		staffID, ok := adminapi.StaffIDFromContext(r.Context())
		if !ok || staffID == "" {
			adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
			return
		}
		uid := strings.TrimSpace(chi.URLParam(r, "userID"))
		var body struct {
			DurationMinutes int    `json:"duration_minutes"`
			Reason          string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || uid == "" || body.DurationMinutes <= 0 || strings.TrimSpace(body.Reason) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "user_id, duration_minutes, reason required")
			return
		}
		dur := time.Duration(body.DurationMinutes) * time.Minute
		if dur > 24*time.Hour {
			dur = 24 * time.Hour
		}
		if err := muteUser(r.Context(), pool, uid, staffID, body.Reason, dur); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "mute failed")
			return
		}
		meta, _ := json.Marshal(body)
		_, _ = pool.Exec(r.Context(), `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
			VALUES ($1::uuid, 'chat.mute', 'user', $2, $3::jsonb)
		`, staffID, uid, meta)
		writeStaffJSON(w, map[string]any{"ok": true})
	}
}

func staffBanUser(hub *Hub, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		staffID, ok := adminapi.StaffIDFromContext(r.Context())
		if !ok || staffID == "" {
			adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
			return
		}
		uid := strings.TrimSpace(chi.URLParam(r, "userID"))
		var body struct {
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || uid == "" || strings.TrimSpace(body.Reason) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "user_id and reason required")
			return
		}
		if err := banUser(r.Context(), pool, uid, staffID, body.Reason); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "ban failed")
			return
		}
		meta, _ := json.Marshal(body)
		_, _ = pool.Exec(r.Context(), `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
			VALUES ($1::uuid, 'chat.ban', 'user', $2, $3::jsonb)
		`, staffID, uid, meta)
		if hub != nil {
			hub.DisconnectUser(uid)
			hub.BroadcastSystem("system", "A user has been banned from chat.")
		}
		writeStaffJSON(w, map[string]any{"ok": true})
	}
}

func staffBroadcast(hub *Hub, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		staffID, ok := adminapi.StaffIDFromContext(r.Context())
		if !ok || staffID == "" {
			adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
			return
		}
		var body struct {
			Message string `json:"message"`
			Reason  string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Message) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "message required")
			return
		}
		meta, _ := json.Marshal(map[string]any{"message": body.Message, "reason": body.Reason})
		_, _ = pool.Exec(r.Context(), `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'chat.broadcast', 'chat', $2::jsonb)
		`, staffID, meta)
		if hub != nil {
			hub.BroadcastSystem("system", body.Message)
		}
		writeStaffJSON(w, map[string]any{"ok": true})
	}
}

func staffGetSettings(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var enabled bool
		var slow, minAge int
		_ = pool.QueryRow(r.Context(), `
			SELECT chat_enabled, slow_mode_seconds, min_account_age_seconds FROM chat_settings WHERE id = 1
		`).Scan(&enabled, &slow, &minAge)
		writeStaffJSON(w, map[string]any{
			"chat_enabled": enabled, "slow_mode_seconds": slow, "min_account_age_seconds": minAge,
		})
	}
}

func staffPatchSettings(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		staffID, ok := adminapi.StaffIDFromContext(r.Context())
		if !ok || staffID == "" {
			adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
			return
		}
		var body struct {
			ChatEnabled           *bool `json:"chat_enabled"`
			SlowModeSeconds       *int  `json:"slow_mode_seconds"`
			MinAccountAgeSeconds  *int  `json:"min_account_age_seconds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "bad body")
			return
		}
		if body.ChatEnabled != nil {
			_, _ = pool.Exec(r.Context(), `UPDATE chat_settings SET chat_enabled = $1, updated_at = now() WHERE id = 1`, *body.ChatEnabled)
		}
		if body.SlowModeSeconds != nil {
			_, _ = pool.Exec(r.Context(), `UPDATE chat_settings SET slow_mode_seconds = $1, updated_at = now() WHERE id = 1`, *body.SlowModeSeconds)
		}
		if body.MinAccountAgeSeconds != nil {
			_, _ = pool.Exec(r.Context(), `UPDATE chat_settings SET min_account_age_seconds = $1, updated_at = now() WHERE id = 1`, *body.MinAccountAgeSeconds)
		}
		meta, _ := json.Marshal(body)
		_, _ = pool.Exec(r.Context(), `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'chat.settings', 'chat_settings', $2::jsonb)
		`, staffID, meta)
		var enabled bool
		var slow, minAge int
		_ = pool.QueryRow(r.Context(), `
			SELECT chat_enabled, slow_mode_seconds, min_account_age_seconds FROM chat_settings WHERE id = 1
		`).Scan(&enabled, &slow, &minAge)
		writeStaffJSON(w, map[string]any{
			"chat_enabled": enabled, "slow_mode_seconds": slow, "min_account_age_seconds": minAge,
		})
	}
}

func writeStaffJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func staffListMutes(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := 200
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		rows, err := pool.Query(r.Context(), `
			SELECT m.id, m.user_id::text, m.muted_by::text, m.reason, m.expires_at, m.created_at
			FROM chat_mutes m ORDER BY m.id DESC LIMIT $1
		`, limit)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var id int64
			var uid, mid, reason string
			var exp, ct time.Time
			if err := rows.Scan(&id, &uid, &mid, &reason, &exp, &ct); err != nil {
				continue
			}
			list = append(list, map[string]any{
				"id": id, "user_id": uid, "muted_by": mid, "reason": reason,
				"expires_at": exp.UTC().Format(time.RFC3339), "created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		writeStaffJSON(w, map[string]any{"mutes": list})
	}
}

func staffListBans(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := 200
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		rows, err := pool.Query(r.Context(), `
			SELECT b.id, b.user_id::text, b.banned_by::text, b.reason,
				b.expires_at, b.created_at
			FROM chat_bans b ORDER BY b.id DESC LIMIT $1
		`, limit)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var id int64
			var uid, bid, reason string
			var exp *time.Time
			var ct time.Time
			if err := rows.Scan(&id, &uid, &bid, &reason, &exp, &ct); err != nil {
				continue
			}
			item := map[string]any{
				"id": id, "user_id": uid, "banned_by": bid, "reason": reason,
				"created_at": ct.UTC().Format(time.RFC3339),
			}
			if exp != nil {
				item["expires_at"] = exp.UTC().Format(time.RFC3339)
			}
			list = append(list, item)
		}
		writeStaffJSON(w, map[string]any{"bans": list})
	}
}

func staffListBlockedTerms(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := pool.Query(r.Context(), `
			SELECT id, term, enabled, created_at FROM chat_blocked_terms ORDER BY id DESC LIMIT 500
		`)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var id int64
			var term string
			var en bool
			var ct time.Time
			if err := rows.Scan(&id, &term, &en, &ct); err != nil {
				continue
			}
			list = append(list, map[string]any{
				"id": id, "term": term, "enabled": en, "created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		writeStaffJSON(w, map[string]any{"terms": list})
	}
}

func staffAddBlockedTerm(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Term string `json:"term"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Term) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "term required")
			return
		}
		var id int64
		err := pool.QueryRow(r.Context(), `
			INSERT INTO chat_blocked_terms (term) VALUES ($1)
			ON CONFLICT ((lower(trim(term)))) DO NOTHING RETURNING id
		`, strings.TrimSpace(body.Term)).Scan(&id)
		if err == pgx.ErrNoRows {
			adminapi.WriteError(w, http.StatusConflict, "duplicate", "term already exists")
			return
		}
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
			return
		}
		RefreshBlocklist(r.Context(), pool)
		writeStaffJSON(w, map[string]any{"id": id})
	}
}

func staffDeleteBlockedTerm(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil || id <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
			return
		}
		tag, err := pool.Exec(r.Context(), `DELETE FROM chat_blocked_terms WHERE id = $1`, id)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "delete failed")
			return
		}
		if tag.RowsAffected() == 0 {
			adminapi.WriteError(w, http.StatusNotFound, "not_found", "term not found")
			return
		}
		RefreshBlocklist(r.Context(), pool)
		writeStaffJSON(w, map[string]any{"ok": true})
	}
}
