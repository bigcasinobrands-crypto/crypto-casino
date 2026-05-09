package blueocean

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RemotePlayerIDFromDB returns blueocean_player_links.remote_player_id for wallet/XAPI routing.
func RemotePlayerIDFromDB(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	if pool == nil {
		return "", fmt.Errorf("blueocean: no database pool")
	}
	var remote string
	err := pool.QueryRow(ctx, `
		SELECT remote_player_id FROM blueocean_player_links WHERE user_id = $1::uuid
	`, strings.TrimSpace(userID)).Scan(&remote)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(remote), nil
}

// CreatePlayerRequest is the server-to-server XAPI createPlayer call (form POST).
// Field names match the BOG operator test form / common XAPI conventions (userid, user_username, currency).
// ExtraParams are merged last so operators can match brand-specific keys from the BO testing tool without a code change.
type CreatePlayerRequest struct {
	UserID   string // users.id (UUID string)
	Username string // optional; used for user_username when set
	Email    string // optional fallback for user_username (local-part) when Username is empty
	// ExtraParams merged after env-level BLUEOCEAN_CREATE_PLAYER_EXTRA_JSON (if set); use to add/override fields per call.
	ExtraParams map[string]any
}

// CreatePlayerResult is a best-effort parse of the JSON body.
type CreatePlayerResult struct {
	OK             bool
	AlreadyExists  bool
	RemotePlayerID string
	HTTPStatus     int
	Raw            json.RawMessage
	ErrorMessage   string
}

func mergeCurrencyAgentParams(cfg *config.Config, params map[string]any) {
	if cfg == nil {
		return
	}
	if cur := strings.TrimSpace(cfg.BlueOceanCurrency); cur != "" {
		params["currency"] = cur
	}
	if cfg.BlueOceanMulticurrency {
		params["multicurrency"] = 1
	}
	if aid := strings.TrimSpace(cfg.BlueOceanAgentID); aid != "" {
		if n, err := strconv.ParseInt(aid, 10, 64); err == nil && n > 0 {
			params["agentid"] = n
		} else {
			params["associateid"] = aid
		}
	}
}

func boDisplayUsername(username, email, userID string) string {
	u := strings.TrimSpace(username)
	if u != "" {
		return u
	}
	email = strings.TrimSpace(strings.ToLower(email))
	if email != "" {
		if i := strings.IndexByte(email, '@'); i > 0 {
			local := strings.TrimSpace(email[:i])
			if local != "" {
				return local
			}
		}
	}
	id := strings.TrimSpace(strings.ToLower(userID))
	id = strings.ReplaceAll(id, "-", "")
	if len(id) >= 8 {
		return "player_" + id[:8]
	}
	return "player_" + id
}

// mergePlayerParamMap copies non-empty values from src into dst (shallow). Empty strings are skipped.
func mergePlayerParamMap(dst map[string]any, src map[string]any) {
	if dst == nil || src == nil {
		return
	}
	for k, v := range src {
		if v == nil {
			continue
		}
		if s, ok := v.(string); ok && strings.TrimSpace(s) == "" {
			continue
		}
		dst[k] = v
	}
}

// CreatePlayer calls method createPlayer on the GameHub XAPI.
func (c *Client) CreatePlayer(ctx context.Context, cfg *config.Config, req CreatePlayerRequest) CreatePlayerResult {
	if !c.Configured() {
		return CreatePlayerResult{ErrorMessage: "blueocean: client not configured"}
	}
	uid := strings.TrimSpace(req.UserID)
	if uid == "" {
		return CreatePlayerResult{ErrorMessage: "createPlayer: user id required"}
	}
	xapiUser := uid
	if cfg != nil {
		xapiUser = FormatUserIDForXAPI(uid, cfg.BlueOceanUserIDNoHyphens)
	}
	display := boDisplayUsername(req.Username, req.Email, uid)
	if display == "" {
		return CreatePlayerResult{ErrorMessage: "createPlayer: could not derive user_username"}
	}
	params := map[string]any{
		"userid":        xapiUser,
		"user_username": display,
	}
	mergeCurrencyAgentParams(cfg, params)
	if cfg != nil {
		mergePlayerParamMap(params, cfg.BlueOceanCreatePlayerExtraParams)
	}
	mergePlayerParamMap(params, req.ExtraParams)
	raw, status, err := c.Call(ctx, "createPlayer", params)
	if err != nil {
		return CreatePlayerResult{ErrorMessage: err.Error(), HTTPStatus: status, Raw: raw}
	}
	ok := status >= 200 && status < 300 && createPlayerResponseOK(raw)
	exists := createPlayerIndicatesAlreadyExists(raw, status)
	if exists {
		ok = true
	}
	remote := strings.TrimSpace(extractCreatePlayerRemoteID(raw))
	if remote == "" {
		remote = xapiUser
	}
	var errMsg string
	if !ok {
		errMsg = FormatAPIError(raw, status)
	}
	return CreatePlayerResult{
		OK:             ok,
		AlreadyExists:  exists,
		RemotePlayerID: remote,
		HTTPStatus:     status,
		Raw:            raw,
		ErrorMessage:   errMsg,
	}
}

func createPlayerResponseOK(raw json.RawMessage) bool {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return false
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	return bodyIndicatesSuccess(m)
}

func createPlayerIndicatesAlreadyExists(raw json.RawMessage, httpStatus int) bool {
	s := strings.ToLower(string(raw))
	if strings.Contains(s, "already exist") || strings.Contains(s, "already_exists") ||
		strings.Contains(s, "duplicate") || strings.Contains(s, "player exists") {
		return true
	}
	if httpStatus == 409 {
		return true
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return false
	}
	msg := strings.ToLower(pickProviderMessage(m))
	return strings.Contains(msg, "exist") || strings.Contains(msg, "duplicate")
}

func extractCreatePlayerRemoteID(raw json.RawMessage) string {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	if r, ok := m["response"].(map[string]any); ok {
		if s := digPlayerIDString(r); s != "" {
			return s
		}
	}
	return digPlayerIDString(m)
}

func digPlayerIDString(m map[string]any) string {
	for _, k := range []string{
		"remote_id", "remoteid", "player_id", "playerid",
		"userid", "user_id", "id",
	} {
		if v, ok := m[k]; ok {
			s := formatBOPlayerIDValue(v)
			if s != "" && s != "0" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}

func formatBOPlayerIDValue(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(t)
	case json.Number:
		return strings.TrimSpace(t.String())
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strings.TrimSpace(strings.TrimRight(strings.TrimRight(strconv.FormatFloat(t, 'f', 6, 64), "0"), "."))
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

// EnsurePlayerLink provisions the player on Blue Ocean (createPlayer) and inserts blueocean_player_links
// when no row exists yet. It is safe to call concurrently (last writer wins on remote_player_id).
func EnsurePlayerLink(ctx context.Context, pool *pgxpool.Pool, c *Client, cfg *config.Config, userID string) error {
	if pool == nil || c == nil || !c.Configured() || cfg == nil {
		return nil
	}
	uid := strings.TrimSpace(userID)
	if uid == "" {
		return fmt.Errorf("blueocean: ensure player: empty user id")
	}
	var exists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM blueocean_player_links WHERE user_id = $1::uuid)
	`, uid).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	var username, email *string
	err := pool.QueryRow(ctx, `
		SELECT username, email FROM users WHERE id = $1::uuid
	`, uid).Scan(&username, &email)
	if err != nil {
		return err
	}
	uStr, eStr := "", ""
	if username != nil {
		uStr = *username
	}
	if email != nil {
		eStr = *email
	}
	res := c.CreatePlayer(ctx, cfg, CreatePlayerRequest{
		UserID:   uid,
		Username: uStr,
		Email:    eStr,
	})
	if !res.OK {
		return fmt.Errorf("blueocean createPlayer: %s", res.ErrorMessage)
	}
	remote := strings.TrimSpace(res.RemotePlayerID)
	_, err = pool.Exec(ctx, `
		INSERT INTO blueocean_player_links (user_id, remote_player_id) VALUES ($1::uuid, $2)
		ON CONFLICT (user_id) DO UPDATE SET remote_player_id = EXCLUDED.remote_player_id
	`, uid, remote)
	return err
}
