package blueocean

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/config"
)

// XAPIResult is a normalized outcome for GameHub XAPI POST calls (see GameHub integration API).
type XAPIResult struct {
	OK           bool
	HTTPStatus   int
	Raw          json.RawMessage
	ErrorMessage string
}

func mergeOptionalStringParams(dst map[string]any, src map[string]any) {
	if src == nil {
		return
	}
	for k, v := range src {
		if v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if strings.TrimSpace(t) == "" {
				continue
			}
			dst[k] = t
		default:
			dst[k] = v
		}
	}
}

// MergeBOGXAPIParams copies params and fills currency / multicurrency / agent from cfg only for missing keys.
func MergeBOGXAPIParams(cfg *config.Config, params map[string]any) map[string]any {
	out := make(map[string]any, len(params)+8)
	for k, v := range params {
		out[k] = v
	}
	if cfg == nil {
		return out
	}
	if _, has := out["currency"]; !has {
		if cur := strings.TrimSpace(cfg.BlueOceanCurrency); cur != "" {
			out["currency"] = cur
		}
	}
	if _, has := out["multicurrency"]; !has && cfg.BlueOceanMulticurrency {
		out["multicurrency"] = 1
	}
	if _, has := out["agentid"]; !has {
		if _, has2 := out["associateid"]; !has2 {
			if aid := strings.TrimSpace(cfg.BlueOceanAgentID); aid != "" {
				if n, err := strconv.ParseInt(aid, 10, 64); err == nil && n > 0 {
					out["agentid"] = n
				} else {
					out["associateid"] = aid
				}
			}
		}
	}
	return out
}

func xapiResponseOK(httpStatus int, raw json.RawMessage) bool {
	if httpStatus < 200 || httpStatus >= 300 {
		return false
	}
	s := strings.TrimSpace(string(raw))
	if s == "" {
		return true
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return true
	}
	return bodyIndicatesSuccess(m)
}

func (c *Client) finishXAPI(ctx context.Context, method string, params map[string]any) XAPIResult {
	if !c.Configured() {
		return XAPIResult{ErrorMessage: "blueocean: client not configured"}
	}
	raw, status, err := c.Call(ctx, method, params)
	if err != nil {
		return XAPIResult{ErrorMessage: err.Error(), HTTPStatus: status, Raw: raw}
	}
	ok := xapiResponseOK(status, raw)
	var errMsg string
	if !ok {
		errMsg = FormatAPIError(raw, status)
	}
	return XAPIResult{OK: ok, HTTPStatus: status, Raw: raw, ErrorMessage: errMsg}
}

// CallXAPIMethod invokes an arbitrary whitelisted GameHub method (used by admin proxy and tests).
func (c *Client) CallXAPIMethod(ctx context.Context, cfg *config.Config, method string, params map[string]any) XAPIResult {
	m := strings.TrimSpace(method)
	if m == "" {
		return XAPIResult{ErrorMessage: "blueocean: empty method"}
	}
	if params == nil {
		params = map[string]any{}
	}
	if m == "playerExists" {
		NormalizePlayerExistsParams(params)
	}
	if m == "loginPlayer" {
		NormalizeLoginPlayerParams(params)
		mergeBOUserPasswordIfConfigured(cfg, params)
	}
	if m == "logoutPlayer" {
		NormalizeLogoutPlayerParams(params)
		mergeBOUserPasswordIfConfigured(cfg, params)
	}
	if m == "getPlayerBalance" {
		NormalizeLoginPlayerParams(params)
		mergeBOUserPasswordIfConfigured(cfg, params)
	}
	merged := MergeBOGXAPIParams(cfg, params)
	stripDeprecatedBOGXAPIUserID(merged)
	finalizeBOUserPasswordParam(cfg, m, merged)
	return c.finishXAPI(ctx, m, merged)
}

// NormalizePlayerExistsParams maps legacy param names to BO-documented playerExists fields.
// Public BO docs require user_username (+ currency via MergeBOGXAPIParams); older examples used userid.
// See https://blueoceangaming.atlassian.net/wiki/spaces/iGPPD/pages/1209172251/2.2+playerExists
func NormalizePlayerExistsParams(params map[string]any) {
	if params == nil {
		return
	}
	if paramNonemptyBOString(params["user_username"]) {
		return
	}
	if paramNonemptyBOString(params["userid"]) {
		params["user_username"] = strings.TrimSpace(fmt.Sprint(params["userid"]))
		delete(params, "userid")
		return
	}
	if paramNonemptyBOString(params["username"]) {
		params["user_username"] = strings.TrimSpace(fmt.Sprint(params["username"]))
		delete(params, "username")
	}
}

func paramNonemptyBOString(v any) bool {
	if v == nil {
		return false
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s) != ""
	}
	out := strings.TrimSpace(fmt.Sprint(v))
	return out != "" && out != "<nil>"
}

// mergeBOUserPasswordIfConfigured adds user_password when BO docs require it (loginPlayer, getPlayerBalance, etc.)
// and the admin body did not supply one. Use the same constant as createPlayer (BLUEOCEAN_CREATE_PLAYER_USER_PASSWORD).
func mergeBOUserPasswordIfConfigured(cfg *config.Config, params map[string]any) {
	if cfg == nil || params == nil {
		return
	}
	if paramNonemptyBOString(params["user_password"]) {
		return
	}
	if pw := strings.TrimSpace(cfg.BlueOceanCreatePlayerUserPassword); pw != "" {
		params["user_password"] = pw
	}
}

// NormalizeLoginPlayerParams maps legacy userid to BO-documented loginPlayer fields (user_username; user_id deprecated).
func NormalizeLoginPlayerParams(params map[string]any) {
	if params == nil {
		return
	}
	if paramNonemptyBOString(params["user_username"]) {
		return
	}
	if paramNonemptyBOString(params["userid"]) {
		params["user_username"] = strings.TrimSpace(fmt.Sprint(params["userid"]))
		delete(params, "userid")
	}
}

// NormalizeLogoutPlayerParams maps legacy userid to user_username for logoutPlayer where BO uses the same shape.
func NormalizeLogoutPlayerParams(params map[string]any) {
	if params == nil {
		return
	}
	if paramNonemptyBOString(params["user_username"]) {
		return
	}
	if paramNonemptyBOString(params["userid"]) {
		params["user_username"] = strings.TrimSpace(fmt.Sprint(params["userid"]))
		delete(params, "userid")
	}
}

// PlayerExists calls method playerExists. Per BO public docs the lookup key is user_username (not userid).
func (c *Client) PlayerExists(ctx context.Context, cfg *config.Config, userUsername string) XAPIResult {
	u := strings.TrimSpace(userUsername)
	params := MergeBOGXAPIParams(cfg, map[string]any{"user_username": u})
	stripDeprecatedBOGXAPIUserID(params)
	return c.finishXAPI(ctx, "playerExists", params)
}

// LoginPlayer calls method loginPlayer. BO public docs use user_username + user_password (+ currency); user_id is deprecated.
// loginUsername must be the BO player user_username (same value as createPlayer), not the numeric BO response id.
func (c *Client) LoginPlayer(ctx context.Context, cfg *config.Config, loginUsername string, extra map[string]any) XAPIResult {
	u := strings.TrimSpace(loginUsername)
	params := map[string]any{"user_username": u}
	mergeOptionalStringParams(params, extra)
	mergeBOUserPasswordIfConfigured(cfg, params)
	merged := MergeBOGXAPIParams(cfg, params)
	stripDeprecatedBOGXAPIUserID(merged)
	finalizeBOUserPasswordParam(cfg, "loginPlayer", merged)
	return c.finishXAPI(ctx, "loginPlayer", merged)
}

// LogoutPlayer calls method logoutPlayer (same user_username shape as login per BO wallet player management).
func (c *Client) LogoutPlayer(ctx context.Context, cfg *config.Config, loginUsername string) XAPIResult {
	u := strings.TrimSpace(loginUsername)
	params := map[string]any{"user_username": u}
	mergeBOUserPasswordIfConfigured(cfg, params)
	merged := MergeBOGXAPIParams(cfg, params)
	stripDeprecatedBOGXAPIUserID(merged)
	finalizeBOUserPasswordParam(cfg, "logoutPlayer", merged)
	return c.finishXAPI(ctx, "logoutPlayer", merged)
}

// GetPlayerBalance calls method getPlayerBalance. BO docs: user must be logged in first; request uses user_username + user_password (+ currency).
func (c *Client) GetPlayerBalance(ctx context.Context, cfg *config.Config, loginUsername string, extra map[string]any) XAPIResult {
	u := strings.TrimSpace(loginUsername)
	params := map[string]any{"user_username": u}
	mergeOptionalStringParams(params, extra)
	mergeBOUserPasswordIfConfigured(cfg, params)
	merged := MergeBOGXAPIParams(cfg, params)
	stripDeprecatedBOGXAPIUserID(merged)
	finalizeBOUserPasswordParam(cfg, "getPlayerBalance", merged)
	return c.finishXAPI(ctx, "getPlayerBalance", merged)
}

// GetDailyBalances calls method getDailyBalances (typically date=YYYY-MM-DD).
func (c *Client) GetDailyBalances(ctx context.Context, cfg *config.Config, date string, extra map[string]any) XAPIResult {
	params := map[string]any{"date": strings.TrimSpace(date)}
	mergeOptionalStringParams(params, extra)
	return c.finishXAPI(ctx, "getDailyBalances", MergeBOGXAPIParams(cfg, params))
}

// GetDailyReport calls method getDailyReport.
func (c *Client) GetDailyReport(ctx context.Context, cfg *config.Config, dateStart, dateEnd, status string, extra map[string]any) XAPIResult {
	params := map[string]any{
		"date_start": strings.TrimSpace(dateStart),
		"date_end":   strings.TrimSpace(dateEnd),
	}
	if s := strings.TrimSpace(status); s != "" {
		params["status"] = s
	}
	mergeOptionalStringParams(params, extra)
	return c.finishXAPI(ctx, "getDailyReport", MergeBOGXAPIParams(cfg, params))
}

// GetGameHistory calls method getGameHistory.
func (c *Client) GetGameHistory(ctx context.Context, cfg *config.Config, remoteUserID, dateStart, dateEnd string, extra map[string]any) XAPIResult {
	params := map[string]any{
		"userid":     strings.TrimSpace(remoteUserID),
		"date_start": strings.TrimSpace(dateStart),
		"date_end":   strings.TrimSpace(dateEnd),
	}
	mergeOptionalStringParams(params, extra)
	return c.finishXAPI(ctx, "getGameHistory", MergeBOGXAPIParams(cfg, params))
}

// GetSystemUsername calls method getSystemUsername.
func (c *Client) GetSystemUsername(ctx context.Context, cfg *config.Config, system string, extra map[string]any) XAPIResult {
	params := map[string]any{"system": strings.TrimSpace(system)}
	mergeOptionalStringParams(params, extra)
	return c.finishXAPI(ctx, "getSystemUsername", MergeBOGXAPIParams(cfg, params))
}

// SetSystemUsername calls method setSystemUsername (system integration user).
func (c *Client) SetSystemUsername(ctx context.Context, cfg *config.Config, system, systemPlayerUsername, systemPlayerPassword string, extra map[string]any) XAPIResult {
	params := map[string]any{
		"system":                 strings.TrimSpace(system),
		"system_player_username": strings.TrimSpace(systemPlayerUsername),
	}
	if p := strings.TrimSpace(systemPlayerPassword); p != "" {
		params["system_player_password"] = p
	}
	mergeOptionalStringParams(params, extra)
	return c.finishXAPI(ctx, "setSystemUsername", MergeBOGXAPIParams(cfg, params))
}

// SetSystemPassword calls method setSystemPassword.
func (c *Client) SetSystemPassword(ctx context.Context, cfg *config.Config, system, systemPlayerUsername, newPassword string, extra map[string]any) XAPIResult {
	params := map[string]any{
		"system":                 strings.TrimSpace(system),
		"system_player_username": strings.TrimSpace(systemPlayerUsername),
		"system_player_password": strings.TrimSpace(newPassword),
	}
	mergeOptionalStringParams(params, extra)
	return c.finishXAPI(ctx, "setSystemPassword", MergeBOGXAPIParams(cfg, params))
}

// AllowedBOGXAPIMethods is the set of methods exposed via the admin XAPI proxy (dropdown parity with BO testing tool).
var AllowedBOGXAPIMethods = map[string]struct{}{
	"getGameList":       {},
	"createPlayer":      {},
	"playerExists":      {},
	"loginPlayer":       {},
	"getGame":           {},
	"getGameDirect":     {},
	"addFreeRounds":     {},
	"logoutPlayer":      {},
	"getDailyBalances":  {},
	"getDailyReport":    {},
	"getGameHistory":    {},
	"getSystemUsername": {},
	"setSystemUsername": {},
	"setSystemPassword": {},
	"removeFreeRounds":   {},
	"getGameDemo":        {},
	"getPlayerBalance":   {},
}

// ListAllowedXAPIMethodNames returns sorted GameHub method names allowed via the admin XAPI proxy.
func ListAllowedXAPIMethodNames() []string {
	out := make([]string, 0, len(AllowedBOGXAPIMethods))
	for m := range AllowedBOGXAPIMethods {
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}

// BOGXAPIRequiresSuperadmin marks methods that can change provider-side player/session/free-round state or system credentials.
func BOGXAPIRequiresSuperadmin(method string) bool {
	switch strings.TrimSpace(method) {
	case "createPlayer", "addFreeRounds", "removeFreeRounds",
		"setSystemUsername", "setSystemPassword", "loginPlayer", "logoutPlayer":
		return true
	default:
		return false
	}
}
