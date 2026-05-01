package blueocean

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/config"
)

// AddFreeRoundsRequest is a server-to-server XAPI addFreeRounds call (form POST, method=addFreeRounds).
// Field names follow the BOG integration test form: title, player id, game id, available rounds, optional validity window.
type AddFreeRoundsRequest struct {
	Title   string
	UserID  string // remote player id (same as getGame `userid`)
	GameID  int64  // Blue Ocean catalog id (getGame `gameid`)
	Rounds  int
	// Optional; when nil, validfrom/validto are omitted (provider default window).
	ValidFrom, ValidTo *string
}

// AddFreeRoundsResult is a best-effort parse of the JSON body.
type AddFreeRoundsResult struct {
	OK           bool
	ProviderRef  string
	HTTPStatus   int
	Raw          json.RawMessage
	ErrorMessage string
}

// AddFreeRounds calls method addFreeRounds. Success is inferred from HTTP 2xx and a BOG-style
// { "error": 0, "response": { ... } } payload; see addFreeRoundsResponseOK.
func (c *Client) AddFreeRounds(ctx context.Context, cfg *config.Config, req AddFreeRoundsRequest) AddFreeRoundsResult {
	if !c.Configured() {
		return AddFreeRoundsResult{ErrorMessage: "blueocean: client not configured"}
	}
	if req.UserID == "" || req.GameID <= 0 || req.Rounds <= 0 {
		return AddFreeRoundsResult{ErrorMessage: "addFreeRounds: user id, game id, rounds required"}
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Free rounds"
	}
	params := map[string]any{
		"title":     title,
		"userid":    req.UserID,
		"gameid":    req.GameID,
		"available": req.Rounds,
	}
	if cfg != nil {
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
	if req.ValidFrom != nil && *req.ValidFrom != "" {
		params["validfrom"] = *req.ValidFrom
	}
	if req.ValidTo != nil && *req.ValidTo != "" {
		params["validto"] = *req.ValidTo
	}
	raw, status, err := c.Call(ctx, "addFreeRounds", params)
	if err != nil {
		return AddFreeRoundsResult{ErrorMessage: err.Error(), HTTPStatus: status}
	}
	ok := status >= 200 && status < 300 && addFreeRoundsResponseOK(raw)
	ref := extractFreeRoundsProviderRef(raw)
	var errMsg string
	if !ok {
		errMsg = FormatAPIError(raw, status)
	}
	return AddFreeRoundsResult{OK: ok, ProviderRef: ref, HTTPStatus: status, Raw: raw, ErrorMessage: errMsg}
}

// addFreeRoundsResponseOK interprets common BOG JSON: error == 0 or missing, optional nested response.
func addFreeRoundsResponseOK(raw json.RawMessage) bool {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return false
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	return bodyIndicatesSuccess(m)
}

func bodyIndicatesSuccess(m map[string]any) bool {
	if m == nil {
		return false
	}
	if v, has := m["error"]; has && !isZeroish(v) {
		return false
	}
	if s, _ := m["status"].(string); s != "" {
		ss := strings.ToLower(strings.TrimSpace(s))
		if ss == "error" || strings.HasPrefix(ss, "4") || strings.HasPrefix(ss, "5") {
			return false
		}
	}
	if v, has := m["status"]; has {
		if f, ok := v.(float64); ok && f != 0 && f != 200 {
			// Some APIs use numeric status; 0 = ok
			if f >= 400 {
				return false
			}
		}
	}
	if r, ok := m["response"].(map[string]any); ok {
		if v, has := r["error"]; has && !isZeroish(v) {
			return false
		}
	}
	return true
}

func isZeroish(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case bool:
		return !t
	case float64:
		return t == 0
	case int:
		return t == 0
	case json.Number:
		return t.String() == "0" || t.String() == "0.0"
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		return s == "" || s == "0" || s == "ok" || s == "200"
	default:
		return false
	}
}

func extractFreeRoundsProviderRef(raw json.RawMessage) string {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	if r, ok := m["response"].(map[string]any); ok {
		if s := digRefString(r); s != "" {
			return s
		}
	}
	if s := digRefString(m); s != "" {
		return s
	}
	return ""
}

func digRefString(m map[string]any) string {
	for _, k := range []string{
		"free_rounds_id", "free_rounds_ids", "freeroundsid", "freerounds_id",
		"transactionid", "transid", "id",
	} {
		if v, ok := m[k]; ok {
			s := strings.TrimSpace(fmt.Sprint(v))
			if s != "" && s != "0" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}
