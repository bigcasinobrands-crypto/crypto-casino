package wallet

import "strings"

// IsPlausibleOnChainDepositAddress returns false for empty strings and for values that look like
// web URLs (e.g. provider accidentally returning a landing page instead of a chain address).
func IsPlausibleOnChainDepositAddress(addr string) bool {
	a := strings.TrimSpace(addr)
	if a == "" {
		return false
	}
	la := strings.ToLower(a)
	if strings.HasPrefix(la, "http://") || strings.HasPrefix(la, "https://") {
		return false
	}
	return true
}
