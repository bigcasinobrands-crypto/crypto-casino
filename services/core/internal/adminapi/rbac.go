package adminapi

import (
	"net/http"
	"slices"
)

// RequireAnyRole returns 403 unless staff JWT role is one of allowed (case-sensitive match to DB).
func RequireAnyRole(allowed ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, ok := StaffRoleFromContext(r.Context())
			if !ok || !slices.Contains(allowed, role) {
				WriteError(w, http.StatusForbidden, "forbidden", "insufficient role")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
