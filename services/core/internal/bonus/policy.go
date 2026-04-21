package bonus

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AbusePolicy is tunable via site_settings key bonus_abuse_policy (merged with these defaults).
type AbusePolicy struct {
	MaxGrantsPerUserPer24h                  int   `json:"max_grants_per_user_per_24h"`
	MaxGrantsSamePromoVersionPerUserPer24h  int   `json:"max_grants_same_promo_version_per_user_per_24h"`
	MinAccountAgeSeconds                    int64 `json:"min_account_age_seconds"`
	MaxConcurrentActiveBonuses              int   `json:"max_concurrent_active_bonuses"`
	MaxLifetimeGrantMinorPerUserPerPromo    int64 `json:"max_lifetime_grant_minor_per_user_per_promo"`
	PromoCodeVerifyCooldownSeconds          int   `json:"promo_code_verify_cooldown_seconds"`
	PromoCodeMaxAttemptsPerIPPerHour        int   `json:"promo_code_max_attempts_per_ip_per_hour"`
	ManualReviewGrantMinorThreshold         int64 `json:"manual_review_grant_minor_threshold"`
	MaxCSVTargetsPerUpload                  int   `json:"max_csv_targets_per_upload"`
}

func defaultAbusePolicy() AbusePolicy {
	return AbusePolicy{
		MaxGrantsPerUserPer24h:                 5,
		MaxGrantsSamePromoVersionPerUserPer24h: 1,
		MinAccountAgeSeconds:                   3600,
		MaxConcurrentActiveBonuses:             1,
		MaxLifetimeGrantMinorPerUserPerPromo:   5_000_000,
		PromoCodeVerifyCooldownSeconds:         30,
		PromoCodeMaxAttemptsPerIPPerHour:       40,
		ManualReviewGrantMinorThreshold:        100_000,
		MaxCSVTargetsPerUpload:                 50_000,
	}
}

// LoadAbusePolicy reads merged policy from DB or defaults.
func LoadAbusePolicy(ctx context.Context, pool *pgxpool.Pool) AbusePolicy {
	p := defaultAbusePolicy()
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = 'bonus_abuse_policy'`).Scan(&raw)
	if err != nil || len(raw) == 0 {
		return p
	}
	var patch AbusePolicy
	if json.Unmarshal(raw, &patch) != nil {
		return p
	}
	if patch.MaxGrantsPerUserPer24h > 0 {
		p.MaxGrantsPerUserPer24h = patch.MaxGrantsPerUserPer24h
	}
	if patch.MaxGrantsSamePromoVersionPerUserPer24h > 0 {
		p.MaxGrantsSamePromoVersionPerUserPer24h = patch.MaxGrantsSamePromoVersionPerUserPer24h
	}
	if patch.MinAccountAgeSeconds > 0 {
		p.MinAccountAgeSeconds = patch.MinAccountAgeSeconds
	}
	if patch.MaxConcurrentActiveBonuses > 0 {
		p.MaxConcurrentActiveBonuses = patch.MaxConcurrentActiveBonuses
	}
	if patch.MaxLifetimeGrantMinorPerUserPerPromo > 0 {
		p.MaxLifetimeGrantMinorPerUserPerPromo = patch.MaxLifetimeGrantMinorPerUserPerPromo
	}
	if patch.PromoCodeVerifyCooldownSeconds > 0 {
		p.PromoCodeVerifyCooldownSeconds = patch.PromoCodeVerifyCooldownSeconds
	}
	if patch.PromoCodeMaxAttemptsPerIPPerHour > 0 {
		p.PromoCodeMaxAttemptsPerIPPerHour = patch.PromoCodeMaxAttemptsPerIPPerHour
	}
	if patch.ManualReviewGrantMinorThreshold > 0 {
		p.ManualReviewGrantMinorThreshold = patch.ManualReviewGrantMinorThreshold
	}
	if patch.MaxCSVTargetsPerUpload > 0 {
		p.MaxCSVTargetsPerUpload = patch.MaxCSVTargetsPerUpload
	}
	return p
}
