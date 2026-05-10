package sitestatus

import (
	"context"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/sitegeo"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	keyMaintenanceMode  = "system.maintenance_mode"
	keyMaintenanceUntil = "system.maintenance_until"
)

// MaintenanceModeFromDB reads kill-switch maintenance from site_settings (admin Settings UI).
func MaintenanceModeFromDB(ctx context.Context, pool *pgxpool.Pool) bool {
	mode, _, err := fetchMaintenanceSettingsUncached(ctx, pool)
	if err != nil {
		return false
	}
	return mode
}

// MaintenanceUntilFromDB returns scheduled end time from site_settings (RFC3339 JSON string), if set.
func MaintenanceUntilFromDB(ctx context.Context, pool *pgxpool.Pool) *time.Time {
	_, until := maintenanceSettingsCached(ctx, pool)
	return until
}

// MaintenanceEffective is true when MAINTENANCE_MODE env is set OR admin toggle (site_settings) is on.
func MaintenanceEffective(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config) bool {
	if cfg != nil && cfg.MaintenanceMode {
		return true
	}
	mode, _ := maintenanceSettingsCached(ctx, pool)
	return mode
}

// GeoBlocked reports whether ISO 3166-1 alpha-2 country code is blocked (DB list overrides env when present).
func GeoBlocked(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, countryISO2 string) bool {
	cc := strings.TrimSpace(strings.ToUpper(countryISO2))
	if cc == "" {
		return false
	}
	blocked := cfg.BlockedCountryCodes
	if dbCodes, err := sitegeo.BlockedCountryCodesFromDB(ctx, pool); err == nil && len(dbCodes) > 0 {
		blocked = dbCodes
	}
	for _, b := range blocked {
		if b == cc {
			return true
		}
	}
	return false
}
