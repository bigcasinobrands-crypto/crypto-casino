// Package socialproof builds CMS-tuned “social proof” numbers for the player shell (sidebar stats).
package socialproof

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TotalWageredStakeMinorSQL matches admin KPI `total_wagered_all` (stakes only, all time).
const TotalWageredStakeMinorSQL = `
SELECT COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
	WHERE entry_type IN ('game.debit','game.bet','sportsbook.debit')), 0)`

// Config is stored in site_settings key `social_proof.config` as JSON.
type Config struct {
	Enabled                bool    `json:"enabled"`
	OnlineTarget           int     `json:"online_target"`
	OnlineVariancePct      float64 `json:"online_variance_pct"`
	OnlineBucketSecs       int     `json:"online_bucket_secs"`
	WagerDisplayMultiplier float64 `json:"wager_display_multiplier"`

	// Recent wins strip (lobby): mixes ledger wins with deterministic bot rows; marquee speed scales with displayed online count.
	RecentWinsEnabled                 bool    `json:"recent_wins_enabled"`
	RecentWinsBaseDurationSec         float64 `json:"recent_wins_base_duration_sec"` // full loop when online ≈ online_target
	RecentWinsFeedSize                int     `json:"recent_wins_feed_size"`
	RecentWinsRealCap               int     `json:"recent_wins_real_cap"`
	RecentWinsMinRealMinor          int64   `json:"recent_wins_min_real_minor"`
	RecentWinsBotMinMinor           int64   `json:"recent_wins_bot_min_minor"`
	RecentWinsBotMaxMinor           int64   `json:"recent_wins_bot_max_minor"`
	RecentWinsRealWeight            int     `json:"recent_wins_real_weight"` // odds weight vs one bot when merging (1–10)
}

func DefaultConfig() Config {
	return Config{
		Enabled:                true,
		OnlineTarget:           180,
		OnlineVariancePct:      22,
		OnlineBucketSecs:       90,
		WagerDisplayMultiplier: 1,

		RecentWinsEnabled:         false,
		RecentWinsBaseDurationSec: 42,
		RecentWinsFeedSize:        28,
		RecentWinsRealCap:         14,
		RecentWinsMinRealMinor:    500,           // $5.00 in USD cents-style minors
		RecentWinsBotMinMinor:     800,           // $8
		RecentWinsBotMaxMinor:     250_000_00,    // $250k cap for display spice
		RecentWinsRealWeight:    3,
	}
}

// configPatch unmarshals site_settings JSON; pointers mean “omit preserves default”.
type configPatch struct {
	Enabled                *bool    `json:"enabled,omitempty"`
	OnlineTarget           *int     `json:"online_target,omitempty"`
	OnlineVariancePct      *float64 `json:"online_variance_pct,omitempty"`
	OnlineBucketSecs       *int     `json:"online_bucket_secs,omitempty"`
	WagerDisplayMultiplier *float64 `json:"wager_display_multiplier,omitempty"`

	RecentWinsEnabled         *bool    `json:"recent_wins_enabled,omitempty"`
	RecentWinsBaseDurationSec *float64 `json:"recent_wins_base_duration_sec,omitempty"`
	RecentWinsFeedSize        *int     `json:"recent_wins_feed_size,omitempty"`
	RecentWinsRealCap       *int     `json:"recent_wins_real_cap,omitempty"`
	RecentWinsMinRealMinor  *int64   `json:"recent_wins_min_real_minor,omitempty"`
	RecentWinsBotMinMinor   *int64   `json:"recent_wins_bot_min_minor,omitempty"`
	RecentWinsBotMaxMinor   *int64   `json:"recent_wins_bot_max_minor,omitempty"`
	RecentWinsRealWeight    *int     `json:"recent_wins_real_weight,omitempty"`
}

// MergeJSON overlays keys from raw JSON onto defaults (missing fields keep defaults).
func MergeJSON(raw []byte) Config {
	cfg := DefaultConfig()
	if len(raw) == 0 {
		return cfg
	}
	var patch configPatch
	if json.Unmarshal(raw, &patch) != nil {
		return cfg
	}
	if patch.Enabled != nil {
		cfg.Enabled = *patch.Enabled
	}
	if patch.OnlineTarget != nil && *patch.OnlineTarget > 0 {
		cfg.OnlineTarget = *patch.OnlineTarget
	}
	if patch.OnlineVariancePct != nil && *patch.OnlineVariancePct > 0 {
		cfg.OnlineVariancePct = clampFloat(*patch.OnlineVariancePct, 5, 55)
	}
	if patch.OnlineBucketSecs != nil && *patch.OnlineBucketSecs > 0 {
		cfg.OnlineBucketSecs = clampInt(*patch.OnlineBucketSecs, 30, 600)
	}
	if patch.WagerDisplayMultiplier != nil && *patch.WagerDisplayMultiplier > 0 {
		cfg.WagerDisplayMultiplier = clampFloat(*patch.WagerDisplayMultiplier, 0.01, 100)
	}
	if patch.RecentWinsEnabled != nil {
		cfg.RecentWinsEnabled = *patch.RecentWinsEnabled
	}
	if patch.RecentWinsBaseDurationSec != nil && *patch.RecentWinsBaseDurationSec > 0 {
		cfg.RecentWinsBaseDurationSec = clampFloat(*patch.RecentWinsBaseDurationSec, 8, 240)
	}
	if patch.RecentWinsFeedSize != nil && *patch.RecentWinsFeedSize > 0 {
		cfg.RecentWinsFeedSize = clampInt(*patch.RecentWinsFeedSize, 8, 80)
	}
	if patch.RecentWinsRealCap != nil && *patch.RecentWinsRealCap >= 0 {
		cfg.RecentWinsRealCap = clampInt(*patch.RecentWinsRealCap, 0, 40)
	}
	if patch.RecentWinsMinRealMinor != nil && *patch.RecentWinsMinRealMinor >= 0 {
		cfg.RecentWinsMinRealMinor = *patch.RecentWinsMinRealMinor
	}
	if patch.RecentWinsBotMinMinor != nil && *patch.RecentWinsBotMinMinor >= 0 {
		cfg.RecentWinsBotMinMinor = *patch.RecentWinsBotMinMinor
	}
	if patch.RecentWinsBotMaxMinor != nil && *patch.RecentWinsBotMaxMinor > 0 {
		cfg.RecentWinsBotMaxMinor = *patch.RecentWinsBotMaxMinor
	}
	if patch.RecentWinsRealWeight != nil && *patch.RecentWinsRealWeight > 0 {
		cfg.RecentWinsRealWeight = clampInt(*patch.RecentWinsRealWeight, 1, 10)
	}
	if cfg.RecentWinsBotMinMinor > cfg.RecentWinsBotMaxMinor {
		cfg.RecentWinsBotMinMinor, cfg.RecentWinsBotMaxMinor = cfg.RecentWinsBotMaxMinor, cfg.RecentWinsBotMinMinor
	}
	return cfg
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func mix64(x uint64) uint64 {
	x ^= x >> 33
	x *= 0xff51afd7ed558ccd
	x ^= x >> 33
	x *= 0xc4ceb9fe1a85ec53
	x ^= x >> 33
	return x
}

// ComputeOnline returns a deterministic “online players” count that moves smoothly around target.
func ComputeOnline(now time.Time, cfg Config) int {
	tgt := cfg.OnlineTarget
	if tgt < 1 {
		tgt = 1
	}
	bucketSecs := cfg.OnlineBucketSecs
	if bucketSecs < 30 {
		bucketSecs = 30
	}
	unix := now.Unix()
	bucket := unix / int64(bucketSecs)
	spread := float64(tgt) * (cfg.OnlineVariancePct / 100.0)
	if spread < 1 {
		spread = 1
	}

	h := mix64(uint64(bucket) ^ uint64(tgt)*0x9e3779b97f4a7c15 ^ uint64(bucketSecs)<<32)
	u := float64(h%10001) / 10000.0 // [0,1]

	phase := math.Sin(2 * math.Pi * float64(unix) / 86400.0)
	diurnal := phase * spread * 0.38
	noise := (u - 0.5) * 2 * spread * 0.62

	x := float64(tgt) + diurnal + noise
	n := int(math.Round(x))

	floor := max(1, tgt/6)
	ceil := tgt + int(math.Ceil(spread*1.35))
	if floor > ceil {
		ceil = floor + 1
	}
	if n < floor {
		n = floor
	}
	if n > ceil {
		n = ceil
	}
	return n
}

// DisplayWageredMinor applies the CMS multiplier to real ledger stakes (minor units).
func DisplayWageredMinor(realMinor int64, cfg Config) int64 {
	if realMinor < 0 {
		realMinor = 0
	}
	m := cfg.WagerDisplayMultiplier
	if m <= 0 {
		m = 1
	}
	return int64(math.Round(float64(realMinor) * m))
}

// BucketUntilUnix is exclusive upper bound of the current refresh bucket (for client polling hints).
func BucketUntilUnix(now time.Time, cfg Config) int64 {
	bucketSecs := cfg.OnlineBucketSecs
	if bucketSecs < 30 {
		bucketSecs = 30
	}
	u := now.Unix()
	next := ((u / int64(bucketSecs)) + 1) * int64(bucketSecs)
	return next
}

// LoadConfig reads site_settings.social_proof.config.
func LoadConfig(ctx context.Context, pool *pgxpool.Pool) Config {
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = 'social_proof.config'`).Scan(&raw)
	if err != nil || len(raw) == 0 {
		return DefaultConfig()
	}
	return MergeJSON(raw)
}

// TotalWageredStakeMinor runs the KPI stakes query.
func TotalWageredStakeMinor(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, TotalWageredStakeMinorSQL).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}
