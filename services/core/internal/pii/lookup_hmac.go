package pii

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// EmailLookupHMAC returns HMAC-SHA256(secret, normalizedEmail) as lowercase hex.
// Used (with a Vault or env-provided secret) for deterministic email lookup without storing plaintext in indexes.
// Returns empty string if secret or email is empty.
func EmailLookupHMAC(secret, email string) string {
	secret = strings.TrimSpace(secret)
	email = strings.TrimSpace(strings.ToLower(email))
	if secret == "" || email == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(email))
	return hex.EncodeToString(mac.Sum(nil))
}

// EmailLookupHMACBytes returns HMAC-SHA256(secret, normalizedEmail) as raw bytes for BYTEA columns (e.g. users.email_hmac).
// Returns nil if secret or email is empty or decoding fails.
func EmailLookupHMACBytes(secret, email string) []byte {
	h := EmailLookupHMAC(secret, email)
	if h == "" {
		return nil
	}
	b, err := hex.DecodeString(h)
	if err != nil || len(b) == 0 {
		return nil
	}
	return b
}
