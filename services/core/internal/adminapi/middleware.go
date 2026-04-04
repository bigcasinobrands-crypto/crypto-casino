package adminapi

import (
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/jwtstaff"
)

func BearerMiddleware(jwtSecret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			id, role, err := jwtstaff.ParseAccess(jwtSecret, raw)
			if err != nil {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
				return
			}
			ctx := WithStaff(r.Context(), id, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
