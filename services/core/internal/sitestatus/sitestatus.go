package sitestatus

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/sitegeo"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type querier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

const (
	keyMaintenanceMode  = "system.maintenance_mode"
	keyMaintenanceUntil = "system.maintenance_until"
)

// MaintenanceModeFromDB reads kill-switch maintenance from site_settings (admin Settings UI).
func MaintenanceModeFromDB(ctx context.Context, pool *pgxpool.Pool) bool {
	b, ok := readBoolSetting(ctx, pool, keyMaintenanceMode)
	return ok && b
}

// MaintenanceUntilFromDB returns scheduled end time from site_settings (RFC3339 JSON string), if set.
func MaintenanceUntilFromDB(ctx context.Context, pool *pgxpool.Pool) *time.Time {
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, keyMaintenanceUntil).Scan(&raw)
	if err != nil {
		return nil
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		s = strings.TrimSpace(string(raw))
		if len(s) >= 2 && s[0] == '"' {
			_ = json.Unmarshal(raw, &s)
		}
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// MaintenanceEffective is true when MAINTENANCE_MODE env is set OR admin toggle (site_settings) is on.
func MaintenanceEffective(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config) bool {
	if cfg != nil && cfg.MaintenanceMode {
		return true
	}
	return MaintenanceModeFromDB(ctx, pool)
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

func readBoolSetting(ctx context.Context, q querier, key string) (bool, bool) {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, key).Scan(&raw)
	if err != nil {
		return false, false
	}
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return b, true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s = strings.TrimSpace(strings.ToLower(s))
		return s == "true" || s == "1" || s == "yes", true
	}
	return false, false
}
