package playerapi

import (
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
)

func bearerRawFromRequest(r *http.Request, accessCookieName string) string {
	h := r.Header.Get("Authorization")
	const p = "bearer "
	if len(h) >= len(p) && strings.ToLower(h[:len(p)]) == p {
		raw := strings.TrimSpace(h[len(p):])
		if raw != "" {
			return raw
		}
	}
	if accessCookieName != "" {
		if c, err := r.Cookie(accessCookieName); err == nil {
			raw := strings.TrimSpace(c.Value)
			if raw != "" {
				return raw
			}
		}
	}
	return ""
}

// OptionalBearerMiddleware parses Bearer token or optional httpOnly access cookie when accessCookieName is non-empty.
func OptionalBearerMiddleware(iss *jwtissuer.Issuer, rev *jtiredis.Revoker, accessCookieName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if iss == nil {
				next.ServeHTTP(w, r)
				return
			}
			raw := bearerRawFromRequest(r, accessCookieName)
			if raw != "" {
				if uid, jti, err := iss.ParsePlayer(raw); err == nil {
					if checkJTI(w, r, rev, jti) {
						return
					}
					r = r.WithContext(WithUserID(r.Context(), uid))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// BearerMiddleware requires Authorization: Bearer or access cookie (when accessCookieName set).
func BearerMiddleware(iss *jwtissuer.Issuer, rev *jtiredis.Revoker, accessCookieName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if iss == nil {
				WriteError(w, http.StatusInternalServerError, "server_error", "jwt not configured")
				return
			}
			raw := bearerRawFromRequest(r, accessCookieName)
			if raw == "" {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}
			uid, jti, err := iss.ParsePlayer(raw)
			if err != nil {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
				return
			}
			if checkJTI(w, r, rev, jti) {
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), uid)))
		})
	}
}

func checkJTI(w http.ResponseWriter, r *http.Request, rev *jtiredis.Revoker, jti string) (reject bool) {
	if rev == nil || jti == "" {
		return false
	}
	revoked, err := rev.IsRevoked(r.Context(), jti)
	if err != nil {
		WriteError(w, http.StatusServiceUnavailable, "unavailable", "session check failed")
		return true
	}
	if revoked {
		WriteError(w, http.StatusUnauthorized, "unauthorized", "token revoked")
		return true
	}
	return false
}
