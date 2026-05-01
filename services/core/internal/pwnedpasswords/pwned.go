package pwnedpasswords

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var apiRangeBase = "https://api.pwnedpasswords.com/range/"

// DefaultUserAgent is sent per Have I Been Pwned API guidance (identify the calling application).
const DefaultUserAgent = "crypto-casino-core (pwnedpasswords; +https://haveibeenpwned.com/API/v3#PwnedPasswords)"

// Checker calls the k-anonymity Pwned Passwords range API (SHA-1 prefix only on the wire).
type Checker struct {
	HTTP *http.Client
}

// NewChecker returns a checker with a bounded timeout suitable for request-path use.
func NewChecker() *Checker {
	return &Checker{
		HTTP: &http.Client{Timeout: 8 * time.Second},
	}
}

// IsCompromised reports whether the password appears in the breach corpus.
// On network or HTTP errors, returns (false, err) — callers may choose to fail-open for availability.
func (c *Checker) IsCompromised(ctx context.Context, password string) (bool, error) {
	if c == nil || c.HTTP == nil {
		return false, fmt.Errorf("pwnedpasswords: nil checker")
	}
	// HIBP Pwned Passwords range API is defined over SHA-1(k-anonymity prefix).
	// nosemgrep: go.lang.security.audit.crypto.use_of_weak_crypto.use-of-sha1
	sum := sha1.Sum([]byte(password))
	hash := strings.ToUpper(hex.EncodeToString(sum[:]))
	prefix := hash[:5]
	suffix := hash[5:]

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiRangeBase+prefix, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", DefaultUserAgent)
	req.Header.Set("Add-Padding", "true")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("pwnedpasswords: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return false, err
	}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) < 1 {
			continue
		}
		rowSuffix := strings.TrimSpace(parts[0])
		if strings.EqualFold(rowSuffix, suffix) {
			return true, nil
		}
	}
	return false, nil
}
