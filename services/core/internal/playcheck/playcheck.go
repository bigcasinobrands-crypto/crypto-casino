package playcheck

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/sitestatus"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LaunchAllowed returns false with a stable machine code if the player must not open real/demo launch.
func LaunchAllowed(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, r *http.Request, userID string) (ok bool, code string) {
	if sitestatus.MaintenanceEffective(ctx, pool, cfg) {
		return false, "maintenance"
	}
	if cfg.DisableGameLaunch {
		return false, "launch_disabled"
	}
	if strings.EqualFold(strings.TrimSpace(cfg.BlueOceanLaunchMode), "real") {
		if f, err := paymentflags.Load(ctx, pool); err == nil && !f.RealPlayEnabled {
			return false, "real_play_paused"
		}
	}
	cc := sitestatus.GeoCountryISO2FromRequest(r)
	if cc != "" && sitestatus.GeoBlocked(ctx, pool, cfg, cc) {
		return false, "geo_blocked"
	}
	if blocked, err := sitestatus.PlayerIPBlocked(ctx, pool, r); err == nil && blocked {
		return false, "ip_blocked"
	}
	var until *time.Time
	var closed *time.Time
	err := pool.QueryRow(ctx, `
		SELECT self_excluded_until, account_closed_at FROM users WHERE id = $1::uuid
	`, userID).Scan(&until, &closed)
	if err != nil {
		return false, "user_not_found"
	}
	if closed != nil {
		return false, "account_closed"
	}
	if until != nil && until.After(time.Now()) {
		return false, "self_excluded"
	}
	return true, ""
}
