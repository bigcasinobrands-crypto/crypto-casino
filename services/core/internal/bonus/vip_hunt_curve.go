package bonus

import (
	"context"
	"database/sql"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EffectiveHuntCurve picks tier-specific thresholds or falls back to global arrays.
func EffectiveHuntCurve(cfg HuntConfig, tierID *int) (thresholds []int64, amounts []int64) {
	if tierID != nil {
		key := strconv.Itoa(*tierID)
		if o, ok := cfg.Tiers[key]; ok && len(o.ThresholdsWagerMinor) > 0 &&
			len(o.AmountsMinor) == len(o.ThresholdsWagerMinor) {
			return o.ThresholdsWagerMinor, o.AmountsMinor
		}
	}
	return cfg.ThresholdsWagerMinor, cfg.AmountsMinor
}

// EffectiveHuntXPBoost returns per-tier boost multiplier; defaults to 1.0.
func EffectiveHuntXPBoost(cfg HuntConfig, tierID *int) float64 {
	if tierID != nil {
		key := strconv.Itoa(*tierID)
		if o, ok := cfg.Tiers[key]; ok && o.XPBoostMultiplier > 0 {
			return o.XPBoostMultiplier
		}
	}
	return 1.0
}

// HuntTierEnabled returns false when tier override explicitly disables hunt.
func HuntTierEnabled(cfg HuntConfig, tierID *int) bool {
	if tierID == nil {
		return true
	}
	key := strconv.Itoa(*tierID)
	if o, ok := cfg.Tiers[key]; ok && o.Enabled != nil {
		return *o.Enabled
	}
	return true
}

// HuntParticipationGate returns false when the player is below min_tier_sort_order (if configured).
func HuntParticipationGate(cfg HuntConfig, tierSortOrder int, hasTier bool) (ok bool, lockedReason string) {
	if cfg.MinTierSortOrder == nil {
		return true, ""
	}
	if !hasTier {
		return false, "vip_tier_required"
	}
	if tierSortOrder < *cfg.MinTierSortOrder {
		return false, "below_min_vip_tier"
	}
	return true, ""
}

// LoadPlayerVIPTierForHunt returns current VIP tier id and sort_order (0-based rank).
func LoadPlayerVIPTierForHunt(ctx context.Context, pool *pgxpool.Pool, userID string) (tierID *int, sortOrder int, hasRow bool) {
	var tid sql.NullInt32
	var sort sql.NullInt32
	err := pool.QueryRow(ctx, `
		SELECT pvs.tier_id, vt.sort_order
		FROM player_vip_state pvs
		LEFT JOIN vip_tiers vt ON vt.id = pvs.tier_id
		WHERE pvs.user_id = $1::uuid
	`, userID).Scan(&tid, &sort)
	if err == pgx.ErrNoRows {
		return nil, -1, false
	}
	if err != nil {
		return nil, -1, false
	}
	if tid.Valid {
		x := int(tid.Int32)
		tierID = &x
	}
	if sort.Valid {
		sortOrder = int(sort.Int32)
	} else {
		sortOrder = -1
	}
	return tierID, sortOrder, true
}
