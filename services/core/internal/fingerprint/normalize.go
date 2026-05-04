package fingerprint

import "strings"

// NormalizeCountryISO2 returns upper-case ISO 3166-1 alpha-2 or empty if invalid.
func NormalizeCountryISO2(s string) string {
	s = strings.TrimSpace(strings.ToUpper(s))
	if len(s) != 2 {
		return ""
	}
	if s[0] < 'A' || s[0] > 'Z' || s[1] < 'A' || s[1] > 'Z' {
		return ""
	}
	return s
}
