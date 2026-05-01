package blueocean

import (
	"fmt"
	"strings"
)

// FormatUserIDForXAPI adjusts the player id sent as XAPI `userid`.
// Some Blue Ocean / studio sandboxes reject canonical UUID strings with hyphens;
// set compactUUID to strip them (32 hex chars) when the input looks like a UUID.
func FormatUserIDForXAPI(userID string, compactUUID bool) string {
	s := strings.TrimSpace(userID)
	if s == "" || !compactUUID {
		return s
	}
	if len(s) == 36 && strings.Count(s, "-") == 4 {
		return strings.ReplaceAll(s, "-", "")
	}
	return s
}

// AlternateUUIDForm returns the other common textual form for a UUID (hyphenated RFC vs 32 hex), or "" if s is neither.
// Used to resolve seamless-wallet callbacks when BO echoes the userid format we sent (compact vs dashed).
func AlternateUUIDForm(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) == 32 && strings.Count(s, "-") == 0 {
		if !isHex32(s) {
			return ""
		}
		return fmt.Sprintf("%s-%s-%s-%s-%s", s[0:8], s[8:12], s[12:16], s[16:20], s[20:32])
	}
	if len(s) == 36 && strings.Count(s, "-") == 4 {
		compact := strings.ReplaceAll(s, "-", "")
		if len(compact) != 32 || !isHex32(compact) {
			return ""
		}
		return compact
	}
	return ""
}

func isHex32(s string) bool {
	if len(s) != 32 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f', r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return true
}
