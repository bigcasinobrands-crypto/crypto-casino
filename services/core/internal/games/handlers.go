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
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/playcheck"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type listRow struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Provider            string `json:"provider"`
	Category            string `json:"category"`
	ThumbnailURL        string `json:"thumbnail_url"`
	GameType            string `json:"game_type,omitempty"`
	ProviderSystem      string `json:"provider_system,omitempty"`
	IsNew               bool   `json:"is_new"`
	FeatureBuySupported bool   `json:"featurebuy_supported"`
	PlayForFunSupported bool   `json:"play_for_fun_supported"`
	Mobile              bool   `json:"mobile"`
	Live                bool   `json:"live"`
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
		if sort == "" {
			sort = "name"
		}

		where := []string{"hidden = false"}
		args := []any{}
		argN := 1

		if category != "" {
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
		if integration == "blueocean" {
			where = append(where, "LOWER(TRIM(COALESCE(provider,''))) = $"+itoa(argN))
			args = append(args, "blueocean")
			argN++
		}
		if provider != "" {
			where = append(where, "provider_system = $"+itoa(argN))
			args = append(args, provider)
			argN++
		}
		if idsRaw != "" {
			var ids []string
			for _, p := range strings.Split(idsRaw, ",") {
				p = strings.TrimSpace(p)
				if p != "" {
					ids = append(ids, p)
				}
			}
			if len(ids) > 0 {
				where = append(where, "id = ANY($"+itoa(argN)+"::text[])")
				args = append(args, ids)
				argN++
			}
		}
		if search != "" {
			where = append(where, "title ILIKE $"+itoa(argN))
			args = append(args, "%"+search+"%")
			argN++
		}
		if pill != "" {
			where = append(where, "$"+itoa(argN)+" = ANY(lobby_tags)")
			args = append(args, pill)
			argN++
		}

		order := "title ASC"
		if featured {
			var hashes []string
			if s.Cfg != nil {
				hashes = s.Cfg.BlueOceanFeaturedIDHashes
			}
			if len(hashes) == 0 {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"games": []listRow{}})
				return
			}
			where = append(where, "id_hash = ANY($"+itoa(argN)+"::text[])")
			order = "array_position($" + itoa(argN) + "::text[], id_hash) NULLS LAST, title ASC"
			args = append(args, hashes)
			argN++
		} else {
			switch sort {
			case "new":
				order = "is_new DESC, title ASC"
			case "provider":
				order = "provider_system ASC NULLS LAST, title ASC"
			case "name":
				order = "title ASC"
			}
		}

		limit := parsePublicLimit(q.Get("limit"))
		offset := parsePublicOffset(q.Get("offset"))

		sqlStr := `
			SELECT id, COALESCE(title,''), COALESCE(provider,''), COALESCE(category,''), COALESCE(thumbnail_url,''),
				COALESCE(game_type,''), COALESCE(provider_system,''),
				COALESCE(is_new,false), COALESCE(featurebuy_supported,false), COALESCE(play_for_fun_supported,false),
				(COALESCE(metadata->>'mobile','') IN ('true','1'))
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
			if err := rows.Scan(&g.ID, &g.Title, &g.Provider, &g.Category, &g.ThumbnailURL,
				&g.GameType, &g.ProviderSystem, &g.IsNew, &g.FeatureBuySupported, &g.PlayForFunSupported, &g.Mobile); err != nil {
				log.Printf("games list: skip row scan: %v", err)
				continue
			}
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
		err := s.Pool.QueryRow(r.Context(), `
			SELECT bog_game_id, COALESCE(play_for_fun_supported,false), COALESCE(hidden,false)
			FROM games WHERE id = $1
		`, body.GameID).Scan(&bogID, &playFun, &hidden)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				playerapi.WriteError(w, http.StatusNotFound, "not_found", "unknown game")
				return
			}
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		if hidden {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "unknown game")
			return
		}

		mode := strings.ToLower(strings.TrimSpace(s.Cfg.BlueOceanLaunchMode))
		if mode == "" {
			mode = "demo"
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

		method := "getGameDemo"
		params := map[string]any{
			"currency":   s.Cfg.BlueOceanCurrency,
			"gameid":     bogID,
			"playforfun": true,
		}
		if mode == "real" {
			method = "getGame"
			params["playforfun"] = false
			remote, err := remotePlayerID(r.Context(), s.Pool, uid)
			if err != nil {
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "player link failed")
				return
			}
			params["userid"] = remote
		} else {
			if !playFun {
				playerapi.WriteError(w, http.StatusConflict, "demo_unavailable", "demo not supported for this game")
				return
			}
		}
		if aid := strings.TrimSpace(s.Cfg.BlueOceanAgentID); aid != "" {
			if n, err := strconv.ParseInt(aid, 10, 64); err == nil && n > 0 {
				params["agentid"] = n
			} else {
				params["associateid"] = aid
			}
		}

		raw, status, err := s.BOG.Call(r.Context(), method, params)
		if err != nil {
			playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "provider request failed")
			return
		}
		if status < 200 || status >= 300 {
			playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "provider returned error")
			return
		}
		url, err := blueocean.ExtractLaunchURL(raw)
		if err != nil || url == "" {
			playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "no launch url in provider response")
			return
		}

		_, _ = s.Pool.Exec(r.Context(), `
			INSERT INTO game_launches (user_id, game_id, mode) VALUES ($1::uuid, $2, $3)
		`, uid, body.GameID, mode)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"url": url, "mode": "iframe"})
	}
}

func remotePlayerID(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	var remote string
	err := pool.QueryRow(ctx, `SELECT remote_player_id FROM blueocean_player_links WHERE user_id = $1::uuid`, userID).Scan(&remote)
	if err == nil && remote != "" {
		return remote, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	remote = userID
	_, err = pool.Exec(ctx, `
		INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)
		ON CONFLICT (user_id) DO UPDATE SET remote_player_id = EXCLUDED.remote_player_id
	`, userID, remote)
	return remote, err
}
