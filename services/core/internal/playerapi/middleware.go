package playerapi

import (
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/jwtplayer"
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
			uid, err := jwtplayer.ParseAccess(jwtSecret, raw)
			if err != nil {
				WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), uid)))
		})
	}
}
