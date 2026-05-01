package securityheaders

import (
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
)

// apiCSP is a strict baseline for JSON APIs (no inline HTML from this service).
const apiCSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

// Middleware sets OWASP-aligned headers. CSP mode comes from config (see Config.SecurityCSPEffectiveMode).
func Middleware(cfg *config.Config) func(http.Handler) http.Handler {
	mode := "off"
	if cfg != nil {
		mode = cfg.SecurityCSPEffectiveMode()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

			if cfg != nil && cfg.AppEnv == "production" {
				// HSTS: TLS must be terminated correctly at the edge before enabling preload.
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}

			switch strings.ToLower(mode) {
			case "enforce":
				w.Header().Set("Content-Security-Policy", apiCSP)
			case "report":
				w.Header().Set("Content-Security-Policy-Report-Only", apiCSP)
			default:
				// off: no CSP (local dev / tests)
			}

			next.ServeHTTP(w, r)
		})
	}
}
