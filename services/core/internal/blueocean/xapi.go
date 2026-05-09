package blueocean

import (
	"context"
	"encoding/json"
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
	merged := MergeBOGXAPIParams(cfg, params)
	return c.finishXAPI(ctx, m, merged)
}

// PlayerExists calls method playerExists for the given remote/XAPI userid.
func (c *Client) PlayerExists(ctx context.Context, cfg *config.Config, remoteUserID string) XAPIResult {
	params := MergeBOGXAPIParams(cfg, map[string]any{"userid": strings.TrimSpace(remoteUserID)})
	return c.finishXAPI(ctx, "playerExists", params)
}

// LoginPlayer calls method loginPlayer. Optional extra keys (e.g. session_id) are merged when non-empty.
func (c *Client) LoginPlayer(ctx context.Context, cfg *config.Config, remoteUserID string, extra map[string]any) XAPIResult {
	params := map[string]any{"userid": strings.TrimSpace(remoteUserID)}
	mergeOptionalStringParams(params, extra)
	return c.finishXAPI(ctx, "loginPlayer", MergeBOGXAPIParams(cfg, params))
}

// LogoutPlayer calls method logoutPlayer.
func (c *Client) LogoutPlayer(ctx context.Context, cfg *config.Config, remoteUserID string) XAPIResult {
	params := MergeBOGXAPIParams(cfg, map[string]any{"userid": strings.TrimSpace(remoteUserID)})
	return c.finishXAPI(ctx, "logoutPlayer", params)
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
	"removeFreeRounds":  {},
	"getGameDemo":       {},
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
