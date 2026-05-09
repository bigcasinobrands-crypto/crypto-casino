package adminops

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/go-chi/chi/v5"
)

func mergeXAPIStep(out map[string]any, prefix string, res blueocean.XAPIResult) {
	out[prefix+"_ok"] = res.OK
	out[prefix+"_http_status"] = res.HTTPStatus
	if res.ErrorMessage != "" {
		out[prefix+"_error"] = res.ErrorMessage
	}
	if len(res.Raw) > 0 {
		var raw any
		if json.Unmarshal(res.Raw, &raw) == nil {
			out[prefix+"_response"] = raw
		} else {
			out[prefix+"_response_raw"] = string(res.Raw)
		}
	}
}

// SyncBlueOceanPlayer runs the same Blue Ocean checks we use in production: EnsurePlayerLink (createPlayer + DB link),
// then playerExists with the stored XAPI user_username. When BLUEOCEAN_CREATE_PLAYER_USER_PASSWORD is set, also calls
// loginPlayer so staff can confirm session XAPI in one click.
func (h *Handler) SyncBlueOceanPlayer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		adminapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST only")
		return
	}
	uid := strings.TrimSpace(chi.URLParam(r, "id"))
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	if h.BOG == nil || !h.BOG.Configured() {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "bog_unconfigured", "Blue Ocean client not configured")
		return
	}
	cfg := h.cfg()
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	out := map[string]any{"user_id": uid}

	ensureErr := blueocean.EnsurePlayerLink(ctx, h.Pool, h.BOG, cfg, uid)
	out["ensure_link_ok"] = ensureErr == nil
	if ensureErr != nil {
		out["ensure_link_error"] = ensureErr.Error()
	}

	var remote, xu string
	_ = h.Pool.QueryRow(ctx, `
		SELECT trim(remote_player_id), trim(COALESCE(xapi_user_username, ''))
		FROM blueocean_player_links WHERE user_id = $1::uuid
	`, uid).Scan(&remote, &xu)
	if remote != "" {
		out["remote_player_id"] = remote
	}
	if xu != "" {
		out["xapi_user_username_stored"] = xu
	}

	loginKey, kerr := blueocean.XAPILoginKeyFromDB(ctx, h.Pool, uid)
	if kerr != nil {
		out["xapi_login_username"] = nil
		out["link_lookup_error"] = kerr.Error()
	} else {
		out["xapi_login_username"] = loginKey
	}

	overall := ensureErr == nil && kerr == nil && loginKey != ""

	runLoginProbe := cfg != nil && strings.TrimSpace(cfg.BlueOceanCreatePlayerUserPassword) != ""
	if !runLoginProbe {
		out["login_player_skipped"] = "set BLUEOCEAN_CREATE_PLAYER_USER_PASSWORD to include loginPlayer in this check"
	}

	if loginKey != "" {
		pe := h.BOG.PlayerExists(ctx, cfg, loginKey)
		mergeXAPIStep(out, "player_exists", pe)
		overall = overall && pe.OK
		if ensureErr == nil && !pe.OK {
			out["player_exists_hint"] = "GameHub reports this user_username is not registered. If the link row was created against another BO environment, or createPlayer never succeeded on this skin, BO back-office lists will not show the player. Confirm BLUEOCEAN_* credentials match the Stage GH1 account; set BLUEOCEAN_CREATE_PLAYER_USER_PASSWORD and re-run so loginPlayer can be verified."
		}

		if runLoginProbe {
			lp := h.BOG.LoginPlayer(ctx, cfg, loginKey, nil)
			mergeXAPIStep(out, "login_player", lp)
			overall = overall && lp.OK
		}
	} else {
		overall = false
	}

	out["ok"] = overall
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(out)
}
