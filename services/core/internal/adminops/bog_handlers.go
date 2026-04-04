package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) cfg() *config.Config {
	if h.Cfg != nil {
		return h.Cfg
	}
	return &config.Config{BlueOceanCurrency: "EUR"}
}

func (h *Handler) SyncBlueOceanCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.BOG == nil || !h.BOG.Configured() {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean client not configured")
		return
	}
	n, err := blueocean.SyncCatalog(r.Context(), h.Pool, h.BOG, h.cfg())
	if err != nil {
		adminapi.WriteError(w, http.StatusBadGateway, "sync_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true, "upserted": n})
}

func (h *Handler) BlueOceanStatus(w http.ResponseWriter, r *http.Request) {
	var lastSync *time.Time
	var errMsg *string
	var n *int
	var cur *string
	_ = h.Pool.QueryRow(r.Context(), `
		SELECT last_sync_at, last_sync_error, last_sync_upserted, last_sync_currency
		FROM blueocean_integration_state WHERE id = 1
	`).Scan(&lastSync, &errMsg, &n, &cur)
	out := map[string]any{
		"bog_configured": h.BOG != nil && h.BOG.Configured(),
	}
	if lastSync != nil {
		out["last_sync_at"] = lastSync.UTC().Format(time.RFC3339)
	}
	if errMsg != nil {
		out["last_sync_error"] = *errMsg
	}
	if n != nil {
		out["last_sync_upserted"] = *n
	}
	if cur != nil {
		out["last_sync_currency"] = *cur
	}
	writeJSON(w, out)
}

func (h *Handler) OperationalFlags(w http.ResponseWriter, r *http.Request) {
	c := h.cfg()
	writeJSON(w, map[string]any{
		"maintenance_mode":    c.MaintenanceMode,
		"disable_game_launch": c.DisableGameLaunch,
		"blueocean_launch_mode": c.BlueOceanLaunchMode,
	})
}

func (h *Handler) ListGamesAdmin(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 200)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, title, provider, COALESCE(category,''), COALESCE(thumbnail_url,''),
			COALESCE(game_type,''), COALESCE(provider_system,''), hidden, COALESCE(hidden_reason,''),
			COALESCE(bog_game_id,0), updated_at
		FROM games ORDER BY updated_at DESC LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, title, prov, cat, thumb, gt, ps, hr string
		var hid bool
		var bog int
		var up time.Time
		if err := rows.Scan(&id, &title, &prov, &cat, &thumb, &gt, &ps, &hid, &hr, &bog, &up); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "title": title, "provider": prov, "category": cat, "thumbnail_url": thumb,
			"game_type": gt, "provider_system": ps, "hidden": hid, "hidden_reason": hr,
			"bog_game_id": bog, "updated_at": up.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"games": list})
}

type patchHiddenReq struct {
	Hidden bool   `json:"hidden"`
	Reason string `json:"reason"`
}

func (h *Handler) PatchGameHidden(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "missing id")
		return
	}
	var body patchHiddenReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	reason := strings.TrimSpace(body.Reason)
	tag, err := h.Pool.Exec(r.Context(), `
		UPDATE games SET hidden = $2, hidden_reason = NULLIF($3,''), updated_at = now() WHERE id = $1
	`, id, body.Hidden, reason)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "game not found")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "missing id")
		return
	}
	var email string
	var created time.Time
	var selfExcl, closed *time.Time
	err := h.Pool.QueryRow(r.Context(), `
		SELECT email, created_at, self_excluded_until, account_closed_at
		FROM users WHERE id = $1::uuid
	`, id).Scan(&email, &created, &selfExcl, &closed)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	out := map[string]any{
		"id": id, "email": email, "created_at": created.UTC().Format(time.RFC3339),
	}
	if selfExcl != nil {
		out["self_excluded_until"] = selfExcl.UTC().Format(time.RFC3339)
	}
	if closed != nil {
		out["account_closed_at"] = closed.UTC().Format(time.RFC3339)
	}
	writeJSON(w, out)
}

func (h *Handler) GDPRExportUser(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "missing id")
		return
	}
	var email string
	var created time.Time
	err := h.Pool.QueryRow(r.Context(), `SELECT email, created_at FROM users WHERE id = $1::uuid`, id).Scan(&email, &created)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	var ledgerN int
	_ = h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM ledger_entries WHERE user_id = $1::uuid`, id).Scan(&ledgerN)
	var launchN int
	_ = h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM game_launches WHERE user_id = $1::uuid`, id).Scan(&launchN)
	writeJSON(w, map[string]any{
		"user_id":              id,
		"email":                email,
		"created_at":           created.UTC().Format(time.RFC3339),
		"ledger_entries_count": ledgerN,
		"game_launches_count":  launchN,
		"note":                 "Expand with full export pipeline per legal retention policy.",
	})
}

func (h *Handler) ListGameLaunches(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	uid := strings.TrimSpace(r.URL.Query().Get("user_id"))
	var rows pgx.Rows
	var err error
	if uid != "" {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT id, user_id::text, game_id, mode, created_at
			FROM game_launches WHERE user_id = $1::uuid ORDER BY id DESC LIMIT $2
		`, uid, limit)
	} else {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT id, user_id::text, game_id, mode, created_at
			FROM game_launches ORDER BY id DESC LIMIT $1
		`, limit)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var u, gid, mode string
		var ct time.Time
		if err := rows.Scan(&id, &u, &gid, &mode, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": strconv.FormatInt(id, 10), "user_id": u, "game_id": gid, "mode": mode,
			"created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"launches": list})
}

func (h *Handler) ListGameDisputes(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, user_id::text, game_id, status, notes, created_at
		FROM game_disputes ORDER BY id DESC LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var uid, gid, status, notes *string
		var ct time.Time
		if err := rows.Scan(&id, &uid, &gid, &status, &notes, &ct); err != nil {
			continue
		}
		m := map[string]any{"id": id, "created_at": ct.UTC().Format(time.RFC3339)}
		if uid != nil {
			m["user_id"] = *uid
		}
		if gid != nil {
			m["game_id"] = *gid
		}
		if status != nil {
			m["status"] = *status
		}
		if notes != nil {
			m["notes"] = *notes
		}
		list = append(list, m)
	}
	writeJSON(w, map[string]any{"disputes": list})
}
