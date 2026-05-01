package adminapi

import (
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
)

func BearerMiddleware(iss *jwtissuer.Issuer, rev *jtiredis.Revoker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if iss == nil {
				WriteError(w, http.StatusInternalServerError, "server_error", "jwt not configured")
				return
			}
			h := r.Header.Get("Authorization")
			const p = "bearer "
			if len(h) < len(p) || strings.ToLower(h[:len(p)]) != p {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}
			raw := strings.TrimSpace(h[len(p):])
			if raw == "" {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}
			id, role, jti, err := iss.ParseStaff(raw)
			if err != nil {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
				return
			}
			if rev != nil && jti != "" {
				revoked, rerr := rev.IsRevoked(r.Context(), jti)
				if rerr != nil {
					WriteError(w, http.StatusServiceUnavailable, "unavailable", "session check failed")
					return
				}
				if revoked {
					WriteError(w, http.StatusUnauthorized, "unauthorized", "token revoked")
					return
				}
			}
			ctx := WithStaff(r.Context(), id, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
