package kycaid

import (
	"crypto/hmac"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

// VerifyCallbackIntegrity checks KYCAID's x-data-integrity header per their docs:
// Base64(raw_body) → HMAC-SHA512 using API token → hex digest matches header.
func VerifyCallbackIntegrity(rawBody []byte, apiToken string, headerValue string) bool {
	apiToken = strings.TrimSpace(apiToken)
	headerValue = strings.TrimSpace(headerValue)
	if apiToken == "" || headerValue == "" || len(rawBody) == 0 {
		return false
	}
	b64 := base64.StdEncoding.EncodeToString(rawBody)
	mac := hmac.New(sha512.New, []byte(apiToken))
	mac.Write([]byte(b64))
	want := mac.Sum(nil)
	got, err := hex.DecodeString(headerValue)
	if err != nil || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}
