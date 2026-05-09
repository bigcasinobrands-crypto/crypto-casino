// Package playercookies sets player session cookies when PLAYER_COOKIE_AUTH is enabled.
//
// Operators — cookie names (WAF / support / CDN cookie lists):
//   - cc_player_access  — httpOnly; JWT access (Bearer alternative for /v1).
//   - cc_player_refresh — httpOnly; JWT refresh (optional body on POST /v1/auth/refresh and /logout).
//   - cc_player_csrf    — not httpOnly; SPA sends the same value in X-CSRF-Token (see CSRFHeaderName) on mutating requests.
package playercookies

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
)

// Cookie names for httpOnly player session transport (Phase 2b).
const (
	AccessCookieName  = "cc_player_access"
	RefreshCookieName = "cc_player_refresh"
	// CSRFCookieName — non-httpOnly; double-submit pair with CSRFHeaderName when PLAYER_COOKIE_AUTH is on.
	CSRFCookieName = "cc_player_csrf"
	// ReferralPendingCookieName — httpOnly; first-party referral code pending registration (set by POST /v1/referrals/attribution).
	ReferralPendingCookieName = "cc_referral_pending"
	// CSRFHeaderName must match the client header (browser preflight allows it via CORS).
	CSRFHeaderName = "X-CSRF-Token"
)

// SetAuth sets httpOnly cookies mirroring access/refresh JWTs (same-origin or CORS credentials).
func SetAuth(w http.ResponseWriter, access, refresh string, accessExpUnix int64, cfg *config.Config) {
	if cfg == nil || !cfg.PlayerCookieAuth {
		return
	}
	secure := cfg.AppEnv == "production"
	same := http.SameSiteLaxMode
	switch cfg.PlayerCookieSameSite {
	case "strict":
		same = http.SameSiteStrictMode
	case "none":
		same = http.SameSiteNoneMode
		secure = true
	case "lax":
		same = http.SameSiteLaxMode
	}

	now := time.Now().Unix()
	maxAgeAccess := int(accessExpUnix - now)
	if maxAgeAccess < 60 {
		maxAgeAccess = 60
	}
	// Secure is set from config (production / SameSite=None requires HTTPS); Semgrep does not track the local variable.
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
	http.SetCookie(w, &http.Cookie{
		Name:     AccessCookieName,
		Value:    access,
		Path:     "/",
		MaxAge:   maxAgeAccess,
		HttpOnly: true,
		Secure:   secure,
		SameSite: same,
	})
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
	http.SetCookie(w, &http.Cookie{
		Name:     RefreshCookieName,
		Value:    refresh,
		Path:     "/",
		MaxAge:   int((7 * 24 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: same,
	})
}

// ClearAuth expires player auth cookies.
func ClearAuth(w http.ResponseWriter, cfg *config.Config) {
	if cfg == nil || !cfg.PlayerCookieAuth {
		return
	}
	secure := cfg.AppEnv == "production"
	same := http.SameSiteLaxMode
	switch cfg.PlayerCookieSameSite {
	case "strict":
		same = http.SameSiteStrictMode
	case "none":
		same = http.SameSiteNoneMode
		secure = true
	case "lax":
		same = http.SameSiteLaxMode
	}
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
	expire := &http.Cookie{Name: AccessCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: same}
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
	expireR := &http.Cookie{Name: RefreshCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: same}
	http.SetCookie(w, expire)
	http.SetCookie(w, expireR)
	// CSRF double-submit token must be readable by the SPA; Secure follows cfg (see package doc).
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure, go.lang.security.audit.net.cookie-missing-httponly.cookie-missing-httponly
	expireCsrf := &http.Cookie{Name: CSRFCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: false, Secure: secure, SameSite: same}
	http.SetCookie(w, expireCsrf)
}

// RefreshFromCookie returns the refresh token from the standard cookie if present.
func RefreshFromCookie(r *http.Request) string {
	c, err := r.Cookie(RefreshCookieName)
	if err != nil || c.Value == "" {
		return ""
	}
	return c.Value
}

// AccessFromCookie returns the access JWT from cookie if present.
func AccessFromCookie(r *http.Request) string {
	c, err := r.Cookie(AccessCookieName)
	if err != nil || c.Value == "" {
		return ""
	}
	return c.Value
}

// SetCSRF issues a fresh double-submit token (non-httpOnly so the SPA can mirror it in X-CSRF-Token).
func SetCSRF(w http.ResponseWriter, cfg *config.Config) error {
	if cfg == nil || !cfg.PlayerCookieAuth {
		return nil
	}
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return err
	}
	token := hex.EncodeToString(b[:])
	secure := cfg.AppEnv == "production"
	same := http.SameSiteLaxMode
	switch cfg.PlayerCookieSameSite {
	case "strict":
		same = http.SameSiteStrictMode
	case "none":
		same = http.SameSiteNoneMode
		secure = true
	case "lax":
		same = http.SameSiteLaxMode
	}
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure, go.lang.security.audit.net.cookie-missing-httponly.cookie-missing-httponly
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int((7 * 24 * time.Hour).Seconds()),
		HttpOnly: false,
		Secure:   secure,
		SameSite: same,
	})
	return nil
}

func referralPendingFlags(cfg *config.Config) (secure bool, same http.SameSite) {
	if cfg == nil {
		return false, http.SameSiteLaxMode
	}
	secure = cfg.AppEnv == "production"
	same = http.SameSiteLaxMode
	switch cfg.PlayerCookieSameSite {
	case "strict":
		same = http.SameSiteStrictMode
	case "none":
		same = http.SameSiteNoneMode
		secure = true
	case "lax":
		same = http.SameSiteLaxMode
	}
	return secure, same
}

// SetReferralPending stores a referral code for registration binding (30-day TTL).
func SetReferralPending(w http.ResponseWriter, cfg *config.Config, code string) {
	if w == nil || cfg == nil {
		return
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return
	}
	secure, same := referralPendingFlags(cfg)
	maxAge := int((30 * 24 * time.Hour).Seconds())
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
	http.SetCookie(w, &http.Cookie{
		Name:     ReferralPendingCookieName,
		Value:    code,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: same,
	})
}

// ReferralPendingFromRequest returns the pending referral cookie value if present.
func ReferralPendingFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	c, err := r.Cookie(ReferralPendingCookieName)
	if err != nil || c == nil || strings.TrimSpace(c.Value) == "" {
		return ""
	}
	return strings.TrimSpace(c.Value)
}

// ClearReferralPending expires the referral pending cookie.
func ClearReferralPending(w http.ResponseWriter, cfg *config.Config) {
	if w == nil || cfg == nil {
		return
	}
	secure, same := referralPendingFlags(cfg)
	// nosemgrep: go.lang.security.audit.net.cookie-missing-secure.cookie-missing-secure
	http.SetCookie(w, &http.Cookie{
		Name:     ReferralPendingCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: same,
	})
}
