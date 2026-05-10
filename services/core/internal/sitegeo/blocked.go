package sitegeo

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SettingKeyBlockedCountries is the site_settings key for comma-/space-separated ISO-3166 alpha-2 codes.
const SettingKeyBlockedCountries = "security.blocked_countries"

type cacheEntry struct {
	at    time.Time
	codes []string
}

var (
	mu    sync.RWMutex
	cache cacheEntry
	ttl   = 8 * time.Second
)

// BlockedCountryCodesFromDB returns uppercase ISO-3166 alpha-2 codes from site_settings.
// Empty slice means "no DB config" (caller may fall back to env).
func BlockedCountryCodesFromDB(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	mu.RLock()
	if time.Since(cache.at) < ttl && cache.at.After(time.Time{}) {
		out := append([]string(nil), cache.codes...)
		mu.RUnlock()
		return out, nil
	}
	mu.RUnlock()

	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, SettingKeyBlockedCountries).Scan(&raw)
	if err == pgx.ErrNoRows {
		mu.Lock()
		cache = cacheEntry{at: time.Now(), codes: nil}
		mu.Unlock()
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	codes := parseSettingValue(raw)
	mu.Lock()
	cache = cacheEntry{at: time.Now(), codes: codes}
	mu.Unlock()
	return append([]string(nil), codes...), nil
}

// InvalidateBlockedCountriesCache clears cached denylist so PATCH settings take effect immediately.
func InvalidateBlockedCountriesCache() {
	mu.Lock()
	cache = cacheEntry{}
	mu.Unlock()
}

func parseSettingValue(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var asStr string
	if json.Unmarshal(raw, &asStr) == nil && asStr != "" {
		return splitCountryCodes(asStr)
	}
	var asArr []string
	if json.Unmarshal(raw, &asArr) == nil {
		return normalizeCodes(asArr)
	}
	return splitCountryCodes(strings.TrimSpace(string(raw)))
}

func splitCountryCodes(s string) []string {
	parts := strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t'
	})
	return normalizeCodes(parts)
}

func normalizeCodes(parts []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, p := range parts {
		c := strings.ToUpper(strings.TrimSpace(p))
		if len(c) != 2 {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		out = append(out, c)
	}
	return out
}
