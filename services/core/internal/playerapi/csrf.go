package playerapi

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playercookies"
)

// PlayerCookieCSRFMiddleware enforces double-submit CSRF for mutating /v1 requests when
// session cookies are present and PLAYER_COOKIE_AUTH is enabled.
//
// Safe methods GET/HEAD/OPTIONS skip the check. Exempt paths (no CSRF token required):
//   - Any /v1/webhooks/* (server-to-server; not browser cookie sessions)
//   - POST only: /v1/auth/login, /v1/auth/register, /v1/auth/refresh,
//     /v1/auth/forgot-password, /v1/auth/reset-password, /v1/auth/verify-email
//
// Other mutating methods (PATCH, PUT, DELETE) are checked when access or refresh cookies are sent.
func PlayerCookieCSRFMiddleware(cfg *config.Config) func(http.Handler) http.Handler {
	if cfg == nil || !cfg.PlayerCookieAuth {
		return func(next http.Handler) http.Handler { return next }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			path := r.URL.Path
			if playerCSRFExempt(r.Method, path) {
				next.ServeHTTP(w, r)
				return
			}
			if playercookies.AccessFromCookie(r) == "" && playercookies.RefreshFromCookie(r) == "" {
				next.ServeHTTP(w, r)
				return
			}
			hdr := r.Header.Get(playercookies.CSRFHeaderName)
			c, err := r.Cookie(playercookies.CSRFCookieName)
			if err != nil || c.Value == "" || hdr == "" ||
				subtle.ConstantTimeCompare([]byte(c.Value), []byte(hdr)) != 1 {
				WriteError(w, http.StatusForbidden, "csrf_failed", "invalid or missing csrf token")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func playerCSRFExempt(method, path string) bool {
	if strings.HasPrefix(path, "/v1/webhooks/") || strings.HasPrefix(path, "/v1/oddin/") {
		return true
	}
	if method != http.MethodPost {
		return false
	}
	switch path {
	case "/v1/auth/login",
		"/v1/auth/register",
		"/v1/auth/refresh",
		"/v1/auth/forgot-password",
		"/v1/auth/reset-password",
		"/v1/auth/verify-email",
		"/v1/referrals/attribution":
		return true
	default:
		return false
	}
}
