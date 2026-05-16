package games

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/playcheck"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5"
)

// blueoceanSportsbookLogGameID is a hidden system row (migration 00023) used for game_launches FK
// when launching via BLUEOCEAN_SPORTSBOOK_BOG_GAME_ID or custom XAPI without a catalog tile.
const blueoceanSportsbookLogGameID = "__blueocean_sportsbook__"

type sportsbookLaunchReq struct {
	Mode     string `json:"mode,omitempty"`
	PlayMode string `json:"play_mode,omitempty"`
}

type sportsbookResolve struct {
	LogGameID    string
	BogID        int64
	Title        string
	ThumbnailURL string
	PlayForFun   bool
}

func (s *Server) resolveSportsbook(ctx context.Context) (sportsbookResolve, error) {
	if s.Cfg == nil {
		return sportsbookResolve{}, errors.New("sportsbook: not configured")
	}
	cfg := s.Cfg
	customXAPI := strings.TrimSpace(cfg.BlueOceanSportsbookXAPIMethod) != ""

	// 1) Explicit catalog row (internal games.id) — operator points at the main sportsbook tile from BO.
	if gid := strings.TrimSpace(cfg.BlueOceanSportsbookCatalogGameID); gid != "" {
		var bog int64
		var title, thumb string
		var playFun bool
		var hidden, provHidden bool
		err := s.Pool.QueryRow(ctx, `
			SELECT COALESCE(g.bog_game_id, 0), COALESCE(g.title, ''), `+EffectiveThumbnailAliased("g")+`,
				COALESCE(g.play_for_fun_supported, true), COALESCE(g.hidden, false), COALESCE(pls.lobby_hidden, false)
			FROM games g
			LEFT JOIN provider_lobby_settings pls ON pls.provider = g.provider
			WHERE g.id = $1
		`, gid).Scan(&bog, &title, &thumb, &playFun, &hidden, &provHidden)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sportsbookResolve{}, errors.New("sportsbook: configured catalog game not found")
			}
			return sportsbookResolve{}, err
		}
		if hidden || provHidden {
			return sportsbookResolve{}, errors.New("sportsbook: catalog game unavailable")
		}
		if bog == 0 && !customXAPI {
			return sportsbookResolve{}, errors.New("sportsbook: catalog game has no bog_game_id")
		}
		if title == "" {
			title = "Sportsbook"
		}
		return sportsbookResolve{
			LogGameID:    gid,
			BogID:        bog,
			Title:        title,
			ThumbnailURL: thumb,
			PlayForFun:   playFun,
		}, nil
	}

	// 2) Direct BO numeric id (from BO onboarding — full sportsbook product, may not appear as a lobby “game”).
	if cfg.BlueOceanSportsbookBOGID > 0 {
		return sportsbookResolve{
			LogGameID:  blueoceanSportsbookLogGameID,
			BogID:      cfg.BlueOceanSportsbookBOGID,
			Title:      "Sportsbook",
			PlayForFun: true,
		}, nil
	}

	// 3) Custom XAPI method only (BO documents method + params separately).
	if customXAPI {
		return sportsbookResolve{
			LogGameID:  blueoceanSportsbookLogGameID,
			BogID:      0,
			Title:      "Sportsbook",
			PlayForFun: true,
		}, nil
	}

	// 4) Heuristic: sports category, exclude virtual-sports mini games, prefer game_type sportsbook.
	var id string
	var bog int64
	var title, thumb string
	var playFun bool
	err := s.Pool.QueryRow(ctx, `
		SELECT g.id, COALESCE(g.bog_game_id, 0), COALESCE(g.title, ''), `+EffectiveThumbnailAliased("g")+`,
			COALESCE(g.play_for_fun_supported, true)
		FROM games g
		LEFT JOIN provider_lobby_settings pls ON pls.provider = g.provider
		WHERE COALESCE(g.hidden, false) = false
			AND COALESCE(pls.lobby_hidden, false) = false
			AND LOWER(TRIM(COALESCE(g.provider, ''))) = 'blueocean'
			AND COALESCE(g.category, '') = 'sports'
			AND LOWER(TRIM(COALESCE(g.game_type, ''))) <> 'virtual-sports'
			AND COALESCE(g.bog_game_id, 0) > 0
		ORDER BY CASE WHEN LOWER(TRIM(COALESCE(g.game_type, ''))) = 'sportsbook' THEN 0 ELSE 1 END,
			g.title ASC
		LIMIT 1
	`).Scan(&id, &bog, &title, &thumb, &playFun)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sportsbookResolve{}, errors.New("sportsbook: no eligible catalog row — set BLUEOCEAN_SPORTSBOOK_GAME_ID or BLUEOCEAN_SPORTSBOOK_BOG_GAME_ID")
		}
		return sportsbookResolve{}, err
	}
	if title == "" {
		title = "Sportsbook"
	}
	return sportsbookResolve{
		LogGameID:    id,
		BogID:        bog,
		Title:        title,
		ThumbnailURL: thumb,
		PlayForFun:   playFun,
	}, nil
}

// SportsbookContextHandler returns display metadata for /casino/sports (public).
func (s *Server) SportsbookContextHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		res, err := s.resolveSportsbook(r.Context())
		if err != nil {
			log.Printf("sportsbook context resolve: %v", err)
			playerapi.WriteError(w, http.StatusServiceUnavailable, "sportsbook_unconfigured", "Sportsbook is not available right now.")
			return
		}
		usesCustom := s.Cfg != nil && strings.TrimSpace(s.Cfg.BlueOceanSportsbookXAPIMethod) != ""
		out := map[string]any{
			"title":            res.Title,
			"thumbnail_url":    nil,
			"catalog_game_id":  nil,
			"uses_custom_xapi": usesCustom,
		}
		if strings.TrimSpace(res.ThumbnailURL) != "" {
			out["thumbnail_url"] = res.ThumbnailURL
		}
		if res.LogGameID != blueoceanSportsbookLogGameID {
			out["catalog_game_id"] = res.LogGameID
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// SportsbookLaunchHandler launches the full sportsbook via getGame/getGameDemo or a custom BO XAPI method.
func (s *Server) SportsbookLaunchHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body sportsbookLaunchReq
		_ = json.NewDecoder(r.Body).Decode(&body)

		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok || uid == "" {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		if ok, code := playcheck.LaunchAllowed(r.Context(), s.Pool, s.Cfg, r, uid); !ok {
			playerapi.WriteError(w, http.StatusForbidden, code, "play not allowed")
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

		res, err := s.resolveSportsbook(r.Context())
		if err != nil {
			log.Printf("sportsbook launch resolve: %v", err)
			playerapi.WriteError(w, http.StatusServiceUnavailable, "sportsbook_unconfigured", "Sportsbook is not available right now.")
			return
		}

		if s.BOG == nil || !s.BOG.Configured() {
			playerapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean API is not configured")
			return
		}

		remote, boLogin, err := remotePlayerID(r.Context(), s.Pool, uid, s.Cfg, s.BOG)
		if err != nil {
			log.Printf("sportsbook launch remote player: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "Could not prepare your session.")
			return
		}

		customMethod := strings.TrimSpace(s.Cfg.BlueOceanSportsbookXAPIMethod)
		if customMethod != "" {
			rUser := remote
			if s.Cfg != nil {
				rUser = blueocean.FormatUserIDForXAPI(remote, s.Cfg.BlueOceanUserIDNoHyphens)
			}
			params := map[string]any{
				"currency":   "EUR",
				"userid":     rUser,
				"playforfun": mode != "real",
			}
			if lu := strings.TrimSpace(boLogin); lu != "" {
				params["user_username"] = lu
			}
			if s.Cfg != nil {
				if c := strings.TrimSpace(s.Cfg.BlueOceanCurrency); c != "" {
					params["currency"] = c
				}
				if s.Cfg.BlueOceanMulticurrency {
					params["multicurrency"] = 1
				}
			}
			if res.BogID > 0 {
				params["gameid"] = res.BogID
			}
			mergeBlueOceanAgentParams(s.Cfg, params)
			for k, v := range s.Cfg.BlueOceanSportsbookXAPIExtraParams {
				params[k] = v
			}

			raw, status, callErr := s.BOG.Call(r.Context(), customMethod, params)
			if callErr != nil {
				log.Printf("sportsbook launch: transport error method=%s: %v", customMethod, callErr)
				playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "We couldn't open the sportsbook right now. Try again shortly.")
				return
			}
			if status < 200 || status >= 300 {
				msg := blueocean.FormatAPIError(raw, status)
				log.Printf("sportsbook launch: provider HTTP %d method=%s: %s", status, customMethod, msg)
				playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "We couldn't open the sportsbook right now. Try again shortly.")
				return
			}
			if !blueocean.LaunchPayloadOK(raw) {
				msg := appendBlueOceanLaunchHints(blueocean.FormatAPIError(raw, status), s.Cfg)
				log.Printf("sportsbook launch: provider failure method=%s: %s", customMethod, msg)
				playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "We couldn't open the sportsbook right now. Try again shortly.")
				return
			}
			launchURL, err := blueocean.ExtractLaunchURL(raw)
			if err != nil || launchURL == "" {
				msg := blueocean.FormatAPIError(raw, status)
				log.Printf("sportsbook launch: missing launch URL method=%s: %s", customMethod, msg)
				playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "We couldn't open the sportsbook right now. Try again shortly.")
				return
			}
			_, _ = s.Pool.Exec(r.Context(), `
				INSERT INTO game_launches (user_id, game_id, mode) VALUES ($1::uuid, $2, $3)
			`, uid, res.LogGameID, mode)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"url": launchURL, "mode": "iframe"})
			return
		}

		launchURL, err := s.blueOceanLaunchFromBogID(r.Context(), remote, boLogin, res.BogID, mode, res.PlayForFun)
		if err != nil {
			if errors.Is(err, errDemoNotSupported) {
				playerapi.WriteError(w, http.StatusConflict, "demo_unavailable", "demo not supported for this product")
				return
			}
			if errors.Is(err, errBogUnconfigured) {
				playerapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean API is not configured")
				return
			}
			log.Printf("sportsbook launch blueocean: %v", err)
			playerapi.WriteError(w, http.StatusBadGateway, "bog_error", "We couldn't open the sportsbook right now. Try again shortly.")
			return
		}

		_, _ = s.Pool.Exec(r.Context(), `
			INSERT INTO game_launches (user_id, game_id, mode) VALUES ($1::uuid, $2, $3)
		`, uid, res.LogGameID, mode)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"url": launchURL, "mode": "iframe"})
	}
}
