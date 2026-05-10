package playerapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/sitestatus"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PlayerSiteBarrierMiddleware enforces maintenance mode, geo denylist, and IP allow/deny on player /v1 routes.
// It runs after CORS; OPTIONS preflight bypasses checks. Operator callbacks and public CMS reads stay allowlisted.
func PlayerSiteBarrierMiddleware(pool *pgxpool.Pool, cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if siteBarrierBypass(r.URL.Path, r.Method) {
				next.ServeHTTP(w, r)
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 1800*time.Millisecond)
			defer cancel()

			if sitestatus.MaintenanceEffective(ctx, pool, cfg) {
				WriteError(w, http.StatusServiceUnavailable, "site_maintenance", "Site is temporarily unavailable.")
				return
			}

			cc := sitestatus.GeoCountryISO2FromRequest(r)
			if cc != "" && sitestatus.GeoBlocked(ctx, pool, cfg, cc) {
				WriteError(w, http.StatusForbidden, "geo_blocked", "Service not available in your region.")
				return
			}

			blocked, err := sitestatus.PlayerIPBlocked(ctx, pool, r)
			if err == nil && blocked {
				WriteError(w, http.StatusForbidden, "ip_blocked", "Access from this network is not permitted.")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func siteBarrierBypass(path, method string) bool {
	if method == http.MethodOptions {
		return true
	}

	switch {
	case strings.HasPrefix(path, "/v1/oddin/"):
		return true
	case strings.HasPrefix(path, "/v1/webhooks/"):
		return true
	}

	rest, ok := strings.CutPrefix(path, "/v1/")
	if !ok {
		return true
	}

	switch {
	case rest == "site/maintenance-notify" && method == http.MethodPost:
		return true
	case rest == "settings/public" && method == http.MethodGet:
		return true
	case rest == "social-proof" && method == http.MethodGet:
		return true
	case rest == "content/bundle" && method == http.MethodGet:
		return true
	case strings.HasPrefix(rest, "content/") && method == http.MethodGet:
		return true
	case strings.HasPrefix(rest, "uploads/"):
		return method == http.MethodGet || method == http.MethodHead
	default:
		return false
	}
}
