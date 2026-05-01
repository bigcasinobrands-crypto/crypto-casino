package blueocean

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ExtractLaunchURL finds an iframe/game URL in getGame / getGameDemo JSON.
func ExtractLaunchURL(raw json.RawMessage) (string, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", err
	}
	if u := walkForURL(root); u != "" {
		return u, nil
	}
	return "", fmt.Errorf("blueocean: no launch url in response")
}

func walkForURL(v any) string {
	switch t := v.(type) {
	case string:
		if strings.HasPrefix(t, "http://") || strings.HasPrefix(t, "https://") {
			return t
		}
	case map[string]any:
		for _, key := range []string{"game_url", "url", "launch_url", "gameUrl", "launchUrl", "iframe", "iframe_url"} {
			if s, ok := t[key].(string); ok && isHTTP(s) {
				return s
			}
		}
		for _, inner := range t {
			if u := walkForURL(inner); u != "" {
				return u
			}
		}
	case []any:
		for _, inner := range t {
			if u := walkForURL(inner); u != "" {
				return u
			}
		}
	}
	return ""
}

func isHTTP(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// LaunchPayloadOK reports whether a getGame / getGameDemo JSON body indicates success.
// Blue Ocean often returns HTTP 200 with {"error":1,"message":"Invalid user details!"} when
// XAPI credentials are wrong — callers must check this before ExtractLaunchURL.
func LaunchPayloadOK(raw json.RawMessage) bool {
	if strings.TrimSpace(string(raw)) == "" {
		return false
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return false
	}
	return launchEnvelopeOK(m)
}

func launchEnvelopeOK(m map[string]any) bool {
	if v, has := m["error"]; has && !isZeroish(v) {
		return false
	}
	if s, ok := m["success"].(bool); ok && !s {
		return false
	}
	if r, ok := m["response"].(map[string]any); ok {
		if v, has := r["error"]; has && !isZeroish(v) {
			return false
		}
	}
	return true
}
