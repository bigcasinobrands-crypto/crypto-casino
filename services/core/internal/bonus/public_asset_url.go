package bonus

import (
	"os"
	"strings"
)

// PublicizeStoredAssetURL returns a URL suitable for the player app to load in <img src>.
// If API_PUBLIC_BASE is set (e.g. https://api.example.com) and the stored value is a relative
// API path such as /v1/uploads/..., the full origin is prepended. Otherwise the value is
// returned unchanged (relative paths work when the player and API share the same host or
// the frontend uses VITE_PLAYER_API_ORIGIN).
func PublicizeStoredAssetURL(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	low := strings.ToLower(s)
	if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
		return s
	}
	if strings.HasPrefix(s, "//") {
		return s
	}
	base := strings.TrimSpace(os.Getenv("API_PUBLIC_BASE"))
	if base == "" {
		return s
	}
	base = strings.TrimRight(base, "/")
	if !strings.HasPrefix(s, "/") {
		s = "/" + s
	}
	// Only rewrite known API-served static paths; avoid turning arbitrary site paths into API URLs.
	if !strings.HasPrefix(s, "/v1/") {
		return s
	}
	return base + s
}
