package sitestatus

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maintenanceSettingsCacheTTL = 2 * time.Second

var maintenanceSnapMu sync.Mutex
var maintenanceSnapCached struct {
	at   time.Time
	mode bool
	// untilUTC is owned by the cache; readers get a cloned pointer from MaintenanceUntilFromDB.
	untilUTC *time.Time
}

// InvalidateMaintenanceSettingsCache clears cached maintenance rows so PATCH settings take effect immediately.
func InvalidateMaintenanceSettingsCache() {
	maintenanceSnapMu.Lock()
	maintenanceSnapCached = struct {
		at       time.Time
		mode     bool
		untilUTC *time.Time
	}{}
	maintenanceSnapMu.Unlock()
}

// fetchMaintenanceSettingsUncached loads system.maintenance_mode and system.maintenance_until in one round trip.
func fetchMaintenanceSettingsUncached(ctx context.Context, pool *pgxpool.Pool) (mode bool, untilUTC *time.Time, err error) {
	keys := []string{keyMaintenanceMode, keyMaintenanceUntil}
	rows, err := pool.Query(ctx, `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, keys)
	if err != nil {
		return false, nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var k string
		var raw []byte
		if scanErr := rows.Scan(&k, &raw); scanErr != nil {
			continue
		}
		switch k {
		case keyMaintenanceMode:
			b, ok := parseBoolJSON(raw)
			mode = ok && b
		case keyMaintenanceUntil:
			untilUTC = parseMaintenanceUntilRaw(raw)
		}
	}
	return mode, untilUTC, rows.Err()
}

func maintenanceSettingsCached(ctx context.Context, pool *pgxpool.Pool) (mode bool, untilUTC *time.Time) {
	now := time.Now()
	maintenanceSnapMu.Lock()
	defer maintenanceSnapMu.Unlock()

	if !maintenanceSnapCached.at.IsZero() && now.Sub(maintenanceSnapCached.at) < maintenanceSettingsCacheTTL {
		return maintenanceSnapCached.mode, cloneTimePtr(maintenanceSnapCached.untilUTC)
	}

	mode, untilUTC, err := fetchMaintenanceSettingsUncached(ctx, pool)
	if err != nil {
		// Fail open on DB errors (matches previous readBoolSetting / Until behavior).
		return false, nil
	}
	maintenanceSnapCached.at = now
	maintenanceSnapCached.mode = mode
	maintenanceSnapCached.untilUTC = cloneTimePtr(untilUTC)
	return mode, cloneTimePtr(untilUTC)
}

// MaintenanceEffectiveDirect reads maintenance mode from the DB without process cache (admin transitions).
func MaintenanceEffectiveDirect(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config) bool {
	if cfg != nil && cfg.MaintenanceMode {
		return true
	}
	mode, _, err := fetchMaintenanceSettingsUncached(ctx, pool)
	if err != nil {
		return false
	}
	return mode
}

func parseBoolJSON(raw []byte) (bool, bool) {
	if len(raw) == 0 {
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

func parseMaintenanceUntilRaw(raw []byte) *time.Time {
	if len(raw) == 0 {
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

func cloneTimePtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := *t
	return &u
}
