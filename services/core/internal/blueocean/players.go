package blueocean

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"

	"github.com/jackc/pgx/v5"
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

// XAPILoginKeyFromDB returns the identifier Blue Ocean expects for loginPlayer, logoutPlayer, and playerExists as user_username.
// It prefers xapi_user_username (the createPlayer handle we stored). Legacy rows fall back to remote_player_id.
func XAPILoginKeyFromDB(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	if pool == nil {
		return "", fmt.Errorf("blueocean: no database pool")
	}
	var key string
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(TRIM(xapi_user_username), ''), TRIM(remote_player_id))
		FROM blueocean_player_links WHERE user_id = $1::uuid
	`, strings.TrimSpace(userID)).Scan(&key)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(key), nil
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
	// XAPIUserUsername is the final user_username sent on createPlayer (after prefix / 16-char rule / extras).
	// BO loginPlayer and playerExists expect this string, not the numeric id in RemotePlayerID.
	XAPIUserUsername string
	HTTPStatus       int
	Raw              json.RawMessage
	ErrorMessage     string
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

// blueOceanUserUsernameMaxLen is from BO public createPlayer docs: user_username must be ≤16 chars; longer handles → use player id.
const blueOceanUserUsernameMaxLen = 16

// boCreatePlayerUserUsername applies the 16-char rule: if display is empty or too long, use xapiUser (formatted users.id).
// See BOG createPlayer() — when the handle exceeds the limit, send your player's ID as user_username.
func boCreatePlayerUserUsername(display, xapiUser string) string {
	d := strings.TrimSpace(display)
	x := strings.TrimSpace(xapiUser)
	if x == "" {
		return d
	}
	if d == "" || len(d) > blueOceanUserUsernameMaxLen {
		return x
	}
	return d
}

// applyUserUsernamePrefix prepends BLUEOCEAN_USER_USERNAME_PREFIX when configured (BO Api user "Prefix").
func applyUserUsernamePrefix(cfg *config.Config, display string) string {
	if cfg == nil {
		return strings.TrimSpace(display)
	}
	p := strings.TrimSpace(cfg.BlueOceanUserUsernamePrefix)
	d := strings.TrimSpace(display)
	if p == "" || d == "" {
		return d
	}
	if len(d) >= len(p) && strings.EqualFold(d[:len(p)], p) {
		return d
	}
	return p + d
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

// buildCreatePlayerCallParams builds the form map for createPlayer (userid, user_username, currency, extras).
func buildCreatePlayerCallParams(cfg *config.Config, req CreatePlayerRequest) (map[string]any, string, string) {
	uid := strings.TrimSpace(req.UserID)
	if uid == "" {
		return nil, "", "createPlayer: user id required"
	}
	xapiUser := uid
	if cfg != nil {
		xapiUser = FormatUserIDForXAPI(uid, cfg.BlueOceanUserIDNoHyphens)
	}
	display := boDisplayUsername(req.Username, req.Email, uid)
	display = applyUserUsernamePrefix(cfg, display)
	display = boCreatePlayerUserUsername(display, xapiUser)
	if display == "" {
		return nil, "", "createPlayer: could not derive user_username"
	}
	params := map[string]any{
		"userid":         xapiUser,
		"user_username": display,
	}
	if cfg != nil {
		if p := strings.TrimSpace(cfg.BlueOceanCreatePlayerUserPassword); p != "" {
			params["user_password"] = p
		}
	}
	mergeCurrencyAgentParams(cfg, params)
	if cfg != nil {
		mergePlayerParamMap(params, cfg.BlueOceanCreatePlayerExtraParams)
	}
	mergePlayerParamMap(params, req.ExtraParams)
	sent := strings.TrimSpace(fmt.Sprint(params["user_username"]))
	return params, sent, ""
}

// CreatePlayer calls method createPlayer on the GameHub XAPI.
// We send userid (no underscore) as the stable wallet/XAPI key; BO's deprecated request field is user_id.
// user_username is capped at 16 characters per BO docs; longer derived names fall back to userid.
func (c *Client) CreatePlayer(ctx context.Context, cfg *config.Config, req CreatePlayerRequest) CreatePlayerResult {
	if !c.Configured() {
		return CreatePlayerResult{ErrorMessage: "blueocean: client not configured"}
	}
	params, sentUserUsername, msg := buildCreatePlayerCallParams(cfg, req)
	if msg != "" {
		return CreatePlayerResult{ErrorMessage: msg}
	}
	xapiUser := strings.TrimSpace(fmt.Sprint(params["userid"]))
	finalizeBOUserPasswordParam(cfg, "createPlayer", params)
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
		OK:               ok,
		AlreadyExists:    exists,
		RemotePlayerID:   remote,
		XAPIUserUsername: sentUserUsername,
		HTTPStatus:       status,
		Raw:              raw,
		ErrorMessage:     errMsg,
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
		var xapiMissing bool
		if err := pool.QueryRow(ctx, `
			SELECT (xapi_user_username IS NULL OR trim(xapi_user_username) = '')
			FROM blueocean_player_links WHERE user_id = $1::uuid
		`, uid).Scan(&xapiMissing); err != nil {
			return err
		}
		if !xapiMissing {
			return nil
		}
		var username, email *string
		if err := pool.QueryRow(ctx, `
			SELECT username, email FROM users WHERE id = $1::uuid
		`, uid).Scan(&username, &email); err != nil {
			return err
		}
		uStr, eStr := "", ""
		if username != nil {
			uStr = *username
		}
		if email != nil {
			eStr = *email
		}
		_, sent, msg := buildCreatePlayerCallParams(cfg, CreatePlayerRequest{
			UserID: uid, Username: uStr, Email: eStr,
		})
		if msg != "" || sent == "" {
			return nil
		}
		_, err := pool.Exec(ctx, `
			UPDATE blueocean_player_links SET xapi_user_username = $2
			WHERE user_id = $1::uuid AND (xapi_user_username IS NULL OR trim(xapi_user_username) = '')
		`, uid, sent)
		return err
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
	xu := strings.TrimSpace(res.XAPIUserUsername)
	_, err = pool.Exec(ctx, `
		INSERT INTO blueocean_player_links (user_id, remote_player_id, xapi_user_username)
		VALUES ($1::uuid, $2, NULLIF($3, ''))
		ON CONFLICT (user_id) DO UPDATE SET
			remote_player_id = EXCLUDED.remote_player_id,
			xapi_user_username = COALESCE(NULLIF(EXCLUDED.xapi_user_username, ''), blueocean_player_links.xapi_user_username)
	`, uid, remote, xu)
	return err
}

const userIDsMissingBlueOceanLinkSQL = `
SELECT u.id::text FROM users u
WHERE NOT EXISTS (SELECT 1 FROM blueocean_player_links b WHERE b.user_id = u.id)
  AND u.account_closed_at IS NULL
ORDER BY u.created_at ASC`

// CountUsersMissingBlueOceanLink returns how many open accounts have no blueocean_player_links row yet.
func CountUsersMissingBlueOceanLink(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	if pool == nil {
		return 0, fmt.Errorf("blueocean: no database pool")
	}
	var n int64
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM users u
		WHERE NOT EXISTS (SELECT 1 FROM blueocean_player_links b WHERE b.user_id = u.id)
		  AND u.account_closed_at IS NULL
	`).Scan(&n)
	return n, err
}

// BackfillMissingPlayerLinksOptions controls batch provisioning via createPlayer + link insert.
type BackfillMissingPlayerLinksOptions struct {
	// Limit caps how many users are scanned (0 = no cap).
	Limit int
	// DryRun only enumerates candidates; no XAPI or DB writes (still runs the SELECT).
	DryRun bool
	// SleepBetween pauses after each successful EnsurePlayerLink (ignored on dry-run). Zero disables.
	SleepBetween time.Duration
}

// BackfillMissingPlayerLinks provisions Blue Ocean for users without blueocean_player_links (see EnsurePlayerLink).
// Skips closed accounts (account_closed_at IS NOT NULL). Returns succeeded vs failed EnsurePlayerLink attempts.
func BackfillMissingPlayerLinks(ctx context.Context, pool *pgxpool.Pool, c *Client, cfg *config.Config, opt BackfillMissingPlayerLinksOptions) (succeeded, failed int, err error) {
	if pool == nil || c == nil || !c.Configured() || cfg == nil {
		return 0, 0, fmt.Errorf("blueocean: backfill requires configured client and database pool")
	}
	q := userIDsMissingBlueOceanLinkSQL
	var rows pgx.Rows
	if opt.Limit > 0 {
		rows, err = pool.Query(ctx, q+` LIMIT $1`, opt.Limit)
	} else {
		rows, err = pool.Query(ctx, q)
	}
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return succeeded, failed, err
		}
		if opt.DryRun {
			succeeded++
			continue
		}
		if err := EnsurePlayerLink(ctx, pool, c, cfg, id); err != nil {
			failed++
			continue
		}
		succeeded++
		if opt.SleepBetween > 0 {
			select {
			case <-ctx.Done():
				return succeeded, failed, ctx.Err()
			case <-time.After(opt.SleepBetween):
			}
		}
	}
	return succeeded, failed, rows.Err()
}
