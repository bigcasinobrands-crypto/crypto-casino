package games

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/playcheck"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type listRow struct {
	ID                  string `json:"id"`
	IDHash              string `json:"id_hash,omitempty"`
	Title               string `json:"title"`
	Provider            string `json:"provider"`
	Category            string `json:"category"`
	ThumbnailURL        string `json:"thumbnail_url"`
	ThumbRev            int64  `json:"thumb_rev,omitempty"` // unix seconds; bumps when row/catalog updates (browser cache bust)
	GameType            string `json:"game_type,omitempty"`
	ProviderSystem      string `json:"provider_system,omitempty"`
	IsNew               bool   `json:"is_new"`
	FeatureBuySupported bool   `json:"featurebuy_supported"`
	PlayForFunSupported bool   `json:"play_for_fun_supported"`
	Mobile              bool   `json:"mobile"`
	Live                bool   `json:"live"`
	/** Human copy from games.metadata (description, summary, or long_description) when set in catalog sync. */
	Description string `json:"description,omitempty"`
}

// ListHandler returns games with optional filters.
func (s *Server) ListHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		category := strings.TrimSpace(q.Get("category"))
		integration := strings.ToLower(strings.TrimSpace(q.Get("integration")))
		provider := strings.TrimSpace(q.Get("provider"))
		idsRaw := strings.TrimSpace(q.Get("ids"))
		search := strings.TrimSpace(q.Get("q"))
		sort := strings.TrimSpace(q.Get("sort"))
		pill := strings.TrimSpace(q.Get("pill"))
		featured := parseTruthy(q.Get("featured"))
		bonusRefs := parseTruthy(q.Get("bonus_refs"))
		if sort == "" {
			sort = "name"
		}

		var idList []string
		if idsRaw != "" {
			for _, p := range strings.Split(idsRaw, ",") {
				p = strings.TrimSpace(p)
				if p != "" {
					idList = append(idList, p)
				}
			}
		}
		idsDisclosure := bonusRefs && len(idList) > 0 && !featured

		var where []string
		var args []any
		argN := 1
		order := "title ASC"
		limit := parsePublicLimit(q.Get("limit"))
		offset := parsePublicOffset(q.Get("offset"))

		if idsDisclosure {
			where = []string{"(id = ANY($1::text[]) OR COALESCE(NULLIF(TRIM(id_hash), ''), '') = ANY($1::text[]))"}
			args = []any{idList}
			order = "array_position($1::text[], id)"
			if limit <= 0 {
				limit = len(idList)
			}
			if limit > len(idList) {
				limit = len(idList)
			}
			if limit > 200 {
				limit = 200
			}
			offset = 0
		} else {
			where = []string{
				"hidden = false",
				`NOT EXISTS (
				SELECT 1 FROM provider_lobby_settings pls
				WHERE pls.provider = games.provider AND pls.lobby_hidden = true
			)`,
			}
		}

		if !idsDisclosure && category != "" {
			switch category {
			case "new":
				where = append(where, "is_new = true")
			case "bonus-buys":
				where = append(where, "featurebuy_supported = true")
			default:
				where = append(where, "category = $"+itoa(argN))
				args = append(args, category)
				argN++
			}
		}
		if !idsDisclosure && integration == "blueocean" {
			where = append(where, "LOWER(TRIM(COALESCE(provider,''))) = $"+itoa(argN))
			args = append(args, "blueocean")
			argN++
		}
		if !idsDisclosure && provider != "" {
			// Match studio / sub-provider (Betsoft, Pragmatic Play, …), not exact-only — URLs use labels from the lobby.
			where = append(where, "COALESCE(provider_system,'') ILIKE $"+itoa(argN))
			args = append(args, "%"+provider+"%")
			argN++
		}
		if !idsDisclosure && len(idList) > 0 {
			where = append(where, "(id = ANY($"+itoa(argN)+"::text[]) OR COALESCE(NULLIF(TRIM(id_hash), ''), '') = ANY($"+itoa(argN)+"::text[]))")
			args = append(args, idList)
			argN++
		}
		if !idsDisclosure && search != "" {
			patterns := StudioSearchPatterns(search)
			var groups []string
			for _, pat := range patterns {
				ph := itoa(argN)
				groups = append(groups, "(title ILIKE $"+ph+" OR COALESCE(provider,'') ILIKE $"+ph+
					" OR COALESCE(provider_system,'') ILIKE $"+ph+
					" OR COALESCE(game_type,'') ILIKE $"+ph+
					" OR COALESCE(category,'') ILIKE $"+ph+
					" OR id ILIKE $"+ph+
					" OR COALESCE(metadata::text,'') ILIKE $"+ph+")")
				args = append(args, pat)
				argN++
			}
			if len(groups) > 0 {
				where = append(where, "("+strings.Join(groups, " OR ")+")")
			}
		}
		if !idsDisclosure && pill != "" {
			where = append(where, "$"+itoa(argN)+" = ANY(lobby_tags)")
			args = append(args, pill)
			argN++
		}

		if !idsDisclosure && featured {
			var hashes []string
			if s.Cfg != nil {
				hashes = s.Cfg.BlueOceanFeaturedIDHashes
			}
			if len(hashes) == 0 {
				// No BLUEOCEAN_FEATURED_ID_HASHES: avoid an empty "Hot now" row; show newest titles.
				order = "is_new DESC, title ASC"
			} else {
				where = append(where, "id_hash = ANY($"+itoa(argN)+"::text[])")
				order = "array_position($" + itoa(argN) + "::text[], id_hash) NULLS LAST, title ASC"
				args = append(args, hashes)
				argN++
			}
		} else if !idsDisclosure {
			switch sort {
			case "new":
				order = "is_new DESC, title ASC"
			case "provider":
				order = "provider_system ASC NULLS LAST, title ASC"
			case "name":
				order = "title ASC"
			}
		}

		sqlStr := `
			SELECT id, COALESCE(NULLIF(TRIM(id_hash), ''), ''), COALESCE(title,''), COALESCE(provider,''), COALESCE(category,''), ` + EffectiveThumbnailSQL + `,
				COALESCE(game_type,''), COALESCE(provider_system,''),
				COALESCE(is_new,false), COALESCE(featurebuy_supported,false), COALESCE(play_for_fun_supported,false),
				(COALESCE(metadata->>'mobile','') IN ('true','1')),
				COALESCE(EXTRACT(EPOCH FROM updated_at)::bigint, 0),
				NULLIF(TRIM(COALESCE(
					metadata->>'description',
					metadata->>'summary',
					metadata->>'long_description',
					''
				)), '')
			FROM games
			WHERE ` + strings.Join(where, " AND ") + `
			ORDER BY ` + order
		if limit > 0 {
			sqlStr += ` LIMIT ` + strconv.Itoa(limit)
		}
		if offset > 0 {
			sqlStr += ` OFFSET ` + strconv.Itoa(offset)
		}

		rows, err := s.Pool.Query(r.Context(), sqlStr, args...)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var out []listRow
		for rows.Next() {
			var g listRow
			if err := rows.Scan(&g.ID, &g.IDHash, &g.Title, &g.Provider, &g.Category, &g.ThumbnailURL,
				&g.GameType, &g.ProviderSystem, &g.IsNew, &g.FeatureBuySupported, &g.PlayForFunSupported, &g.Mobile, &g.ThumbRev, &g.Description); err != nil {
				log.Printf("games list: skip row scan: %v", err)
				continue
			}
			g.IDHash = strings.TrimSpace(g.IDHash)
			g.Live = g.GameType == "live-casino" || g.Category == "live"
			out = append(out, g)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"games": out})
	}
}

func itoa(i int) string {
	return strconv.FormatInt(int64(i), 10)
}

func parseTruthy(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	return s == "1" || s == "true" || s == "yes"
}

// parsePublicLimit returns 0 (no cap) or 1..2000 when the client passes limit=.
func parsePublicLimit(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return 0
	}
	if n > 2000 {
		return 2000
	}
	return n
}

func parsePublicOffset(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 0
	}
	if n > 250000 {
		return 250000
	}
	return n
}

type launchReq struct {
	GameID string `json:"game_id"`
	// Mode optional: "demo" | "free_play" | "freeplay" (getGameDemo) or "real" (getGame). play_mode is an alias for mode.
	Mode     string `json:"mode,omitempty"`
	PlayMode string `json:"play_mode,omitempty"`
}

// LaunchHandler returns iframe URL from BOG getGameDemo / getGame.
func (s *Server) LaunchHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body launchReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.GameID == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "game_id required")
			return
		}
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok || uid == "" {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		if ok, code := playcheck.LaunchAllowed(r.Context(), s.Pool, s.Cfg, r, uid); !ok {
			playerapi.WriteError(w, http.StatusForbidden, code, "play not allowed")
			return
		}

		var bogID int64
		var playFun bool
		var hidden bool
		var provHidden bool
		err := s.Pool.QueryRow(r.Context(), `
			SELECT g.bog_game_id, COALESCE(g.play_for_fun_supported,false), COALESCE(g.hidden,false),
				COALESCE(pls.lobby_hidden, false)
			FROM games g
			LEFT JOIN provider_lobby_settings pls ON pls.provider = g.provider
			WHERE g.id = $1
		`, body.GameID).Scan(&bogID, &playFun, &hidden, &provHidden)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				playerapi.WriteError(w, http.StatusNotFound, "not_found", "unknown game")
				return
			}
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		if hidden || provHidden {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "unknown game")
			return
		}

		rawMode := strings.ToLower(strings.TrimSpace(body.Mode))
		if rawMode == "" {
			rawMode = strings.ToLower(strings.TrimSpace(body.PlayMode))
		}
		var mode string
		switch rawMode {
		case "demo", "free_play", "freeplay":
			mode = "demo"
		case "real":
			mode = "real"
		default:
			mode = strings.ToLower(strings.TrimSpace(s.Cfg.BlueOceanLaunchMode))
			if mode == "" {
				mode = "demo"
			}
		}

		if bogID == 0 {
			if mode == "demo" && s.Cfg != nil && strings.HasPrefix(strings.TrimSpace(body.GameID), "demo-") {
				base := strings.TrimSuffix(strings.TrimSpace(s.Cfg.PublicPlayerURL), "/")
				if base != "" {
					demoLaunchURL := base + "/embed/demo/" + url.PathEscape(body.GameID)
					_, _ = s.Pool.Exec(r.Context(), `
						INSERT INTO game_launches (user_id, game_id, mode) VALUES ($1::uuid, $2, $3)
					`, uid, body.GameID, "demo")
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]string{"url": demoLaunchURL, "mode": "iframe"})
					return
				}
			}
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "unknown game")
			return
		}

		if s.BOG == nil || !s.BOG.Configured() {
			playerapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean API is not configured")
			return
		}

		remote, err := remotePlayerID(r.Context(), s.Pool, uid, s.Cfg)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "player link failed")
			return
		}

		launchURL, err := s.blueOceanLaunchFromBogID(r.Context(), remote, bogID, mode, playFun)
		if err != nil {
			if errors.Is(err, errDemoNotSupported) {
				playerapi.WriteError(w, http.StatusConflict, "demo_unavailable", "demo not supported for this game")
				return
			}
			if errors.Is(err, errBogUnconfigured) {
				playerapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean API is not configured")
				return
			}
			log.Printf("games launch: game_id=%s bog_id=%d: %v", body.GameID, bogID, err)
			playerapi.WriteError(w, http.StatusBadGateway, "bog_error", err.Error())
			return
		}

		_, _ = s.Pool.Exec(r.Context(), `
			INSERT INTO game_launches (user_id, game_id, mode) VALUES ($1::uuid, $2, $3)
		`, uid, body.GameID, mode)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"url": launchURL, "mode": "iframe"})
	}
}

// BlueOceanGameInfoHandler returns catalog fields for one game plus Blue Ocean XAPI payload (getGameDirect, else getGameDemo).
func (s *Server) BlueOceanGameInfoHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		gameID := strings.TrimSpace(chi.URLParam(r, "gameID"))
		if gameID == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "game id required")
			return
		}
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok || uid == "" {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		if ok, code := playcheck.LaunchAllowed(r.Context(), s.Pool, s.Cfg, r, uid); !ok {
			playerapi.WriteError(w, http.StatusForbidden, code, "play not allowed")
			return
		}

		var bogID int64
		var title, category, gameType, providerSystem, idHash string
		var metaJSON []byte
		var featBuy, playFun, isNew, hidden, provHidden bool
		err := s.Pool.QueryRow(r.Context(), `
			SELECT COALESCE(g.bog_game_id, 0), COALESCE(g.title, ''), COALESCE(g.category, ''), COALESCE(g.game_type, ''),
				COALESCE(g.provider_system, ''), COALESCE(g.metadata, '{}'::jsonb),
				COALESCE(g.featurebuy_supported, false), COALESCE(g.play_for_fun_supported, false), COALESCE(g.is_new, false),
				COALESCE(g.hidden, false), COALESCE(pls.lobby_hidden, false), COALESCE(NULLIF(TRIM(g.id_hash), ''), '')
			FROM games g
			LEFT JOIN provider_lobby_settings pls ON pls.provider = g.provider
			WHERE g.id = $1
		`, gameID).Scan(&bogID, &title, &category, &gameType, &providerSystem, &metaJSON, &featBuy, &playFun, &isNew, &hidden, &provHidden, &idHash)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				playerapi.WriteError(w, http.StatusNotFound, "not_found", "unknown game")
				return
			}
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		if hidden || provHidden {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "unknown game")
			return
		}

		local := map[string]any{
			"id":                     gameID,
			"title":                  title,
			"category":               category,
			"game_type":              gameType,
			"provider_system":        providerSystem,
			"bog_game_id":            bogID,
			"featurebuy_supported":   featBuy,
			"play_for_fun_supported": playFun,
			"is_new":                 isNew,
		}
		if strings.TrimSpace(idHash) != "" {
			local["id_hash"] = idHash
		}
		var meta any
		if len(metaJSON) > 0 {
			_ = json.Unmarshal(metaJSON, &meta)
		}
		local["metadata"] = meta

		scope := map[string]any{
			"game_id":         gameID,
			"catalog_title":   title,
			"bog_game_id":     bogID,
			"provider_system": providerSystem,
		}
		if strings.TrimSpace(idHash) != "" {
			scope["id_hash"] = idHash
		}

		out := map[string]any{
			"scope":            scope,
			"local":            local,
			"blue_ocean":       nil,
			"blue_ocean_error": nil,
		}

		writeOut := func() {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(out)
		}

		if s.BOG == nil || !s.BOG.Configured() {
			out["blue_ocean_error"] = "Blue Ocean API is not configured"
			writeOut()
			return
		}
		if bogID == 0 {
			out["blue_ocean_error"] = "Game has no Blue Ocean game id (bog_game_id)"
			writeOut()
			return
		}

		mergeAgent := func(m map[string]any) {
			if s.Cfg == nil {
				return
			}
			if aid := strings.TrimSpace(s.Cfg.BlueOceanAgentID); aid != "" {
				if n, err := strconv.ParseInt(aid, 10, 64); err == nil && n > 0 {
					m["agentid"] = n
				} else {
					m["associateid"] = aid
				}
			}
		}

		direct := map[string]any{"gameid": bogID}
		mergeAgent(direct)
		raw, st, callErr := s.BOG.Call(r.Context(), "getGameDirect", direct)
		var payload any
		gotDirect := false
		if callErr == nil && st >= 200 && st < 300 && len(raw) > 0 {
			if json.Unmarshal(raw, &payload) == nil && payload != nil {
				if em, ok := payload.(map[string]any); ok && len(em) == 0 {
					payload = nil
				} else {
					gotDirect = true
				}
			}
		}

		if gotDirect {
			out["blue_ocean"] = payload
			writeOut()
			return
		}

		remote, rerr := remotePlayerID(r.Context(), s.Pool, uid, s.Cfg)
		if rerr != nil {
			out["blue_ocean_error"] = "could not resolve player id for provider"
			writeOut()
			return
		}

		currency := ""
		if s.Cfg != nil {
			currency = s.Cfg.BlueOceanCurrency
		}
		demoUser := remote
		if s.Cfg != nil {
			demoUser = blueocean.FormatUserIDForXAPI(remote, s.Cfg.BlueOceanUserIDNoHyphens)
		}
		demo := map[string]any{
			"currency":   currency,
			"gameid":     bogID,
			"playforfun": true,
			"userid":     demoUser,
		}
		if s.Cfg != nil && s.Cfg.BlueOceanMulticurrency {
			demo["multicurrency"] = 1
		}
		mergeAgent(demo)
		raw, st, callErr = s.BOG.Call(r.Context(), "getGameDemo", demo)
		if callErr != nil {
			out["blue_ocean_error"] = "provider connection failed: " + callErr.Error()
		} else if st < 200 || st >= 300 {
			out["blue_ocean_error"] = blueocean.FormatAPIError(raw, st)
		} else if !blueocean.LaunchPayloadOK(raw) {
			out["blue_ocean_error"] = blueocean.FormatAPIError(raw, st)
		} else {
			payload = nil
			if json.Unmarshal(raw, &payload) == nil {
				out["blue_ocean"] = payload
			}
		}
		writeOut()
	}
}

func remotePlayerID(ctx context.Context, pool *pgxpool.Pool, userID string, cfg *config.Config) (string, error) {
	want := strings.TrimSpace(userID)
	if cfg != nil {
		want = blueocean.FormatUserIDForXAPI(want, cfg.BlueOceanUserIDNoHyphens)
	}
	var remote string
	err := pool.QueryRow(ctx, `SELECT remote_player_id FROM blueocean_player_links WHERE user_id = $1::uuid`, userID).Scan(&remote)
	if err == nil && remote != "" {
		if remote != want {
			if _, uerr := pool.Exec(ctx, `UPDATE blueocean_player_links SET remote_player_id = $2 WHERE user_id = $1::uuid`, userID, want); uerr != nil {
				return "", uerr
			}
		}
		return want, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)
		ON CONFLICT (user_id) DO UPDATE SET remote_player_id = EXCLUDED.remote_player_id
	`, userID, want)
	return want, err
}
