package blueocean

import (
	"encoding/json"
	"fmt"
	"strings"
)

// PlayerExistsTruth reads a playerExists JSON body after an HTTP 2xx from GameHub.
// apiOK is false when the envelope indicates an API error or malformed JSON.
// When apiOK is true, exists reports whether the login handle is registered with the provider.
func PlayerExistsTruth(raw json.RawMessage) (exists bool, apiOK bool) {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil || !bodyIndicatesSuccess(m) {
		return false, false
	}
	r, has := m["response"]
	if !has {
		return false, true
	}
	return playerExistsTruthyResponse(r), true
}

// playerExistsResponseOK interprets GameHub playerExists JSON. Providers often return HTTP 200 with error:0
// and response:false or response:"No" when the login handle is not registered — unlike most XAPI calls where
// a scalar response is success.
func playerExistsResponseOK(m map[string]any) bool {
	if m == nil || !bodyIndicatesSuccess(m) {
		return false
	}
	r, has := m["response"]
	if !has {
		return true
	}
	return playerExistsTruthyResponse(r)
}

func playerExistsTruthyResponse(r any) bool {
	if r == nil {
		return false
	}
	switch t := r.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		if s == "no" || s == "false" || s == "0" || s == "n" {
			return false
		}
		if s == "yes" || s == "true" || s == "1" || s == "y" {
			return true
		}
		return s != ""
	case []any:
		return len(t) > 0
	case map[string]any:
		if len(t) == 0 {
			return false
		}
		for _, key := range []string{"exists", "player_exists", "playerexists", "found", "valid"} {
			if v, ok := t[key]; ok {
				return playerExistsScalarTruthy(v)
			}
		}
		for _, key := range []string{"not_found", "missing"} {
			if v, ok := t[key]; ok && playerExistsScalarTruthy(v) {
				return false
			}
		}
		for _, key := range []string{"remote_id", "remoteid", "player_id", "playerid", "userid", "user_id", "id", "user_username"} {
			if v, ok := t[key]; ok {
				s := strings.TrimSpace(fmt.Sprint(v))
				if s != "" && s != "0" && s != "<nil>" {
					return true
				}
			}
		}
		return false
	default:
		return false
	}
}

func playerExistsScalarTruthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		if s == "no" || s == "false" || s == "0" || s == "n" {
			return false
		}
		return s != ""
	default:
		return v != nil
	}
}
