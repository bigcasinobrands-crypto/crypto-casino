package adminops

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/games"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/sitestatus"
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
	cfg := h.cfg()
	useSnapshot := cfg != nil && strings.TrimSpace(cfg.BlueOceanCatalogSnapshotPath) != ""
	if !useSnapshot && (h.BOG == nil || !h.BOG.Configured()) {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean client not configured")
		return
	}
	// Cap outbound/catalog work (admin routes are mounted without global chi Timeout — see cmd/api/main.go).
	syncCtx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	n, err := blueocean.SyncCatalog(syncCtx, h.Pool, h.BOG, h.cfg())
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
	cfg := h.cfg()
	settlement := strings.ToUpper(strings.TrimSpace(cfg.BlueOceanCurrency))
	if settlement == "" {
		settlement = "EUR"
	}
	out := map[string]any{
		"bog_configured":                    h.BOG != nil && h.BOG.Configured(),
		"settlement_currency":               settlement,
		"multicurrency":                     cfg.BlueOceanMulticurrency,
		"blueocean_xapi_session_sync":       cfg.BlueOceanXAPISessionSync,
		"blueocean_xapi_user_password_sha1": cfg.BlueOceanXAPIUserPasswordSHA1,
		"blueocean_xapi_methods":            blueocean.ListAllowedXAPIMethodNames(),
	}
	if miss, err := blueocean.CountUsersMissingBlueOceanLink(r.Context(), h.Pool); err == nil {
		out["users_missing_player_links"] = miss
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
	if h.Pool != nil {
		if fs, err := bonus.LoadFreeSpinsV1Config(r.Context(), h.Pool); err == nil {
			out["free_spins_v1"] = map[string]any{
				"api_enabled":       fs.APIEnabled,
				"outbound_enabled":  fs.OutboundEnabled,
			}
		}
	}
	writeJSON(w, out)
}

// BlueOceanXAPI proxies a whitelisted GameHub XAPI method (same surface as BO's REST testing form).
// POST body: { "method": "getDailyReport", "params": { ... } }. Currency/agent defaults come from server config when omitted.
func (h *Handler) BlueOceanXAPI(w http.ResponseWriter, r *http.Request) {
	if h.BOG == nil || !h.BOG.Configured() {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean client not configured")
		return
	}
	var body struct {
		Method string         `json:"method"`
		Params map[string]any `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	method := strings.TrimSpace(body.Method)
	if method == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "method required")
		return
	}
	if _, ok := blueocean.AllowedBOGXAPIMethods[method]; !ok {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_method", "method not allowed for proxy")
		return
	}
	role, _ := adminapi.StaffRoleFromContext(r.Context())
	if blueocean.BOGXAPIRequiresSuperadmin(method) && role != "superadmin" {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "this Blue Ocean method requires superadmin")
		return
	}
	params := body.Params
	if params == nil {
		params = map[string]any{}
	}
	res := h.BOG.CallXAPIMethod(r.Context(), h.cfg(), method, params)
	var data any
	if len(res.Raw) > 0 {
		_ = json.Unmarshal(res.Raw, &data)
	}
	writeJSON(w, map[string]any{
		"ok":           res.OK,
		"http_status":  res.HTTPStatus,
		"data":         data,
		"error_detail": res.ErrorMessage,
	})
}

type backfillPlayerLinksReq struct {
	Limit   int  `json:"limit"`
	DryRun  bool `json:"dry_run"`
	SleepMS int  `json:"sleep_ms"`
}

// BackfillBlueOceanPlayerLinks runs createPlayer for users without blueocean_player_links (superadmin).
func (h *Handler) BackfillBlueOceanPlayerLinks(w http.ResponseWriter, r *http.Request) {
	if h.BOG == nil || !h.BOG.Configured() {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean client not configured")
		return
	}
	var body backfillPlayerLinksReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	limit := body.Limit
	const maxBatch = 5000
	if limit <= 0 {
		limit = 500
	}
	if limit > maxBatch {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", fmt.Sprintf("limit cannot exceed %d per request", maxBatch))
		return
	}
	sleepMS := body.SleepMS
	if sleepMS < 0 {
		sleepMS = 0
	}
	if sleepMS == 0 && !body.DryRun {
		sleepMS = 200
	}
	opt := blueocean.BackfillMissingPlayerLinksOptions{
		Limit:        limit,
		DryRun:       body.DryRun,
		SleepBetween: time.Duration(sleepMS) * time.Millisecond,
	}
	ok, fail, err := blueocean.BackfillMissingPlayerLinks(r.Context(), h.Pool, h.BOG, h.cfg(), opt)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadGateway, "backfill_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{
		"ok":               true,
		"dry_run":          body.DryRun,
		"limit":            limit,
		"succeeded":        ok,
		"failed":           fail,
		"sleep_ms_applied": sleepMS,
	})
}
func (h *Handler) OperationalFlags(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	c := h.cfg()
	maintEff := sitestatus.MaintenanceEffective(ctx, h.Pool, c)
	var maintUntil any = nil
	if u := sitestatus.MaintenanceUntilFromDB(ctx, h.Pool); u != nil {
		maintUntil = u.UTC().Format(time.RFC3339)
	}

	out := map[string]any{
		"maintenance_mode":                      maintEff,
		"maintenance_mode_env":                  c.MaintenanceMode,
		"maintenance_until":                     maintUntil,
		"disable_game_launch":                   c.DisableGameLaunch,
		"blueocean_launch_mode":                 c.BlueOceanLaunchMode,
		"bonus_max_bet_violations_auto_forfeit": c.BonusMaxBetViolationsAutoForfeit,
	}
	pf, err := paymentflags.Load(ctx, h.Pool)
	if err != nil {
		pf = paymentflags.OperationalFallback()
	}
	out["deposits_enabled"] = pf.DepositsEnabled
	out["withdrawals_enabled"] = pf.WithdrawalsEnabled
	out["real_play_enabled"] = pf.RealPlayEnabled
	out["bonuses_enabled"] = pf.BonusesEnabled
	out["automated_grants_enabled"] = pf.AutomatedGrantsEnabled

	chatEnabled := true
	_ = h.Pool.QueryRow(ctx, `SELECT COALESCE(chat_enabled, true) FROM chat_settings WHERE id = 1`).Scan(&chatEnabled)
	out["chat_enabled"] = chatEnabled

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, out)
}

func (h *Handler) ListGamesAdmin(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 200)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	prov := strings.TrimSpace(r.URL.Query().Get("provider"))

	argPos := 1
	where := strings.Builder{}
	where.WriteString(`FROM games g
		LEFT JOIN provider_lobby_settings pls ON pls.provider = g.provider
		WHERE 1=1`)
	args := make([]any, 0, 8)
	if prov != "" {
		fmt.Fprintf(&where, " AND g.provider = $%d", argPos)
		args = append(args, prov)
		argPos++
	}
	if q != "" {
		patterns := games.StudioSearchPatterns(q)
		var groups []string
		for _, raw := range patterns {
			like := strings.ToLower(raw)
			p := argPos
			groups = append(groups, fmt.Sprintf(`(
				lower(g.title) LIKE $%d OR lower(g.provider) LIKE $%d OR lower(g.id) LIKE $%d
				OR lower(COALESCE(g.provider_system,'')) LIKE $%d OR lower(COALESCE(g.game_type,'')) LIKE $%d
				OR lower(COALESCE(g.category,'')) LIKE $%d OR lower(COALESCE(g.metadata::text,'')) LIKE $%d)`, p, p, p, p, p, p, p))
			args = append(args, like)
			argPos++
		}
		if len(groups) > 0 {
			where.WriteString(" AND (")
			where.WriteString(strings.Join(groups, " OR "))
			where.WriteString(")")
		}
	}
	fmt.Fprintf(&where, " ORDER BY g.updated_at DESC LIMIT $%d", argPos)
	args = append(args, limit)

	sqlStr := `SELECT g.id, g.title, g.provider, COALESCE(g.category,''), ` + games.EffectiveThumbnailAliased("g") + `,
			COALESCE(g.thumbnail_url,''), COALESCE(g.thumbnail_url_override,''),
			COALESCE(g.game_type,''), COALESCE(g.provider_system,''), g.hidden, COALESCE(g.hidden_reason,''),
			COALESCE(g.bog_game_id,0), g.updated_at,
			COALESCE(pls.lobby_hidden, false)
		` + where.String()
	rows, err := h.Pool.Query(r.Context(), sqlStr, args...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, title, prov, cat, thumbEff, thumbCatalog, thumbOverride, gt, ps, hr string
		var hid bool
		var bog int
		var up time.Time
		var provLobbyHid bool
		if err := rows.Scan(&id, &title, &prov, &cat, &thumbEff, &thumbCatalog, &thumbOverride, &gt, &ps, &hid, &hr, &bog, &up, &provLobbyHid); err != nil {
			continue
		}
		effectiveLobby := !hid && !provLobbyHid
		list = append(list, map[string]any{
			"id": id, "title": title, "provider": prov, "category": cat,
			"thumbnail_url":          thumbEff,
			"thumbnail_url_catalog":  thumbCatalog,
			"thumbnail_url_override": thumbOverride,
			"game_type":              gt, "provider_system": ps, "hidden": hid, "hidden_reason": hr,
			"bog_game_id": bog, "updated_at": up.UTC().Format(time.RFC3339),
			"provider_lobby_hidden": provLobbyHid,
			"effective_in_lobby":    effectiveLobby,
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

type patchThumbnailOverrideReq struct {
	// ClearThumbnailOverride removes staff URL so catalog feed thumbnail shows again.
	ClearThumbnailOverride bool   `json:"clear_thumbnail_override"`
	ThumbnailURLOverride   string `json:"thumbnail_url_override"`
}

func (h *Handler) PatchGameThumbnailOverride(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "missing id")
		return
	}
	var body patchThumbnailOverrideReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	url := strings.TrimSpace(body.ThumbnailURLOverride)
	if body.ClearThumbnailOverride {
		url = ""
	}
	if !body.ClearThumbnailOverride && url == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "set thumbnail_url_override or clear_thumbnail_override")
		return
	}
	var tag interface{ RowsAffected() int64 }
	var err error
	if url == "" {
		tag, err = h.Pool.Exec(r.Context(), `
			UPDATE games SET thumbnail_url_override = NULL, updated_at = now() WHERE id = $1
		`, id)
	} else {
		tag, err = h.Pool.Exec(r.Context(), `
			UPDATE games SET thumbnail_url_override = $2, updated_at = now() WHERE id = $1
		`, id, url)
	}
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

func (h *Handler) ListGameProviders(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		WITH counts AS (
			SELECT provider,
				COUNT(*)::int AS game_count,
				COUNT(*) FILTER (WHERE NOT hidden)::int AS individually_visible_count
			FROM games
			GROUP BY provider
		)
		SELECT c.provider, c.game_count, c.individually_visible_count,
			COALESCE(p.lobby_hidden, false), COALESCE(p.hidden_reason,''), p.updated_at
		FROM counts c
		LEFT JOIN provider_lobby_settings p ON p.provider = c.provider
		ORDER BY c.provider
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var prov string
		var nGames, nVis int
		var lobbyHid bool
		var reason string
		var setAt *time.Time
		if err := rows.Scan(&prov, &nGames, &nVis, &lobbyHid, &reason, &setAt); err != nil {
			continue
		}
		item := map[string]any{
			"provider":                      prov,
			"game_count":                    nGames,
			"individually_visible_count":    nVis,
			"lobby_hidden":                  lobbyHid,
			"hidden_reason":                 reason,
			"effective_lobby_visible_count": 0,
		}
		if !lobbyHid {
			item["effective_lobby_visible_count"] = nVis
		}
		if setAt != nil {
			item["settings_updated_at"] = setAt.UTC().Format(time.RFC3339)
		}
		list = append(list, item)
	}
	var studioCount int
	_ = h.Pool.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT NULLIF(TRIM(provider_system), '')) FROM games
	`).Scan(&studioCount)
	writeJSON(w, map[string]any{"providers": list, "studio_count": studioCount})
}

type patchProviderLobbyReq struct {
	Provider    string `json:"provider"`
	LobbyHidden bool   `json:"lobby_hidden"`
	Reason      string `json:"reason"`
}

func (h *Handler) PatchProviderLobbyHidden(w http.ResponseWriter, r *http.Request) {
	var body patchProviderLobbyReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	prov := strings.TrimSpace(body.Provider)
	if prov == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "provider required")
		return
	}
	reason := strings.TrimSpace(body.Reason)
	_, err := h.Pool.Exec(r.Context(), `
		INSERT INTO provider_lobby_settings (provider, lobby_hidden, hidden_reason, updated_at)
		VALUES ($1, $2, NULLIF($3,''), now())
		ON CONFLICT (provider) DO UPDATE SET
			lobby_hidden = EXCLUDED.lobby_hidden,
			hidden_reason = EXCLUDED.hidden_reason,
			updated_at = now()
	`, prov, body.LobbyHidden, reason)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
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
	var uname, avatar *string
	var email2FAEnabled, email2FAAdminLocked bool
	err := h.Pool.QueryRow(r.Context(), `
		SELECT email, created_at, self_excluded_until, account_closed_at, username, avatar_url,
			COALESCE(email_2fa_enabled, false), COALESCE(email_2fa_admin_locked, false)
		FROM users WHERE id = $1::uuid
	`, id).Scan(&email, &created, &selfExcl, &closed, &uname, &avatar, &email2FAEnabled, &email2FAAdminLocked)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	out := map[string]any{
		"id":                     id,
		"email":                  email,
		"created_at":             created.UTC().Format(time.RFC3339),
		"email_2fa_enabled":      email2FAEnabled,
		"email_2fa_admin_locked": email2FAAdminLocked,
	}
	if uname != nil {
		out["username"] = *uname
	}
	if avatar != nil {
		out["avatar_url"] = *avatar
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
