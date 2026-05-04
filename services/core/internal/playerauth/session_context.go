package playerauth

import (
	"strings"
)

// SessionContext carries HTTP + Fingerprint client hints stored on player_sessions.
type SessionContext struct {
	IP                   string
	UserAgent            string
	GeoCountryHeader     string // X-Geo-Country from edge
	FingerprintRequestID string
	FingerprintVisitorID string
}

func truncateStr(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(strings.TrimSpace(s))
	if len(r) <= max {
		return string(r)
	}
	return string(r[:max])
}
