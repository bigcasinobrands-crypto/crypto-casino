package bonus

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RewardProgramKind matches reward_programs.kind.
type RewardProgramKind string

const (
	RewardKindDailyFixed       RewardProgramKind = "daily_fixed"
	RewardKindWagerRebate      RewardProgramKind = "wager_rebate"
	RewardKindCashbackNetLoss  RewardProgramKind = "cashback_net_loss"
	RewardKindDailyHunt        RewardProgramKind = "daily_hunt"
)

type RewardProgram struct {
	ID                   int64
	ProgramKey           string
	Kind                 RewardProgramKind
	PromotionVersionID   int64
	Config               json.RawMessage
	Enabled              bool
	Priority             int
}

// DailyFixedConfig is JSON for kind daily_fixed.
type DailyFixedConfig struct {
	AmountMinor int64 `json:"amount_minor"`
	// MinQualifyingWagerMinor, if > 0, requires that much successful cash stake (UTC day) before claim.
	MinQualifyingWagerMinor int64 `json:"min_qualifying_wager_minor,omitempty"`
}

// RebateConfig is JSON for wager_rebate / cashback_net_loss.
type RebateConfig struct {
	Period                  string  `json:"period"` // "daily" or "weekly"
	Percent                 int     `json:"percent"`
	CapMinor                int64   `json:"cap_minor"`
	MinQualifyingWagerMinor int64   `json:"min_qualifying_wager_minor,omitempty"`
	MaxPayoutMinor          int64   `json:"max_payout_minor,omitempty"`
	BurstMultiplier         float64 `json:"burst_multiplier,omitempty"`
	BurstCapMinor           int64   `json:"burst_cap_minor,omitempty"`
}

// HuntTierOverride is optional per–VIP-tier milestone ladder (key = vip_tiers.id as decimal string).
type HuntTierOverride struct {
	ThresholdsWagerMinor []int64 `json:"thresholds_wager_minor"`
	AmountsMinor         []int64 `json:"amounts_minor"`
	Enabled              *bool   `json:"enabled,omitempty"`
	XPBoostMultiplier    float64 `json:"xp_boost_multiplier,omitempty"`
	DailyMaxRewardMinor  *int64  `json:"daily_max_reward_minor,omitempty"`
	CardTitle            string  `json:"card_title,omitempty"`
	CardDescription      string  `json:"card_description,omitempty"`
}

// HuntConfig is JSON for daily_hunt ladder.
type HuntConfig struct {
	ThresholdsWagerMinor []int64 `json:"thresholds_wager_minor"`
	AmountsMinor         []int64 `json:"amounts_minor"`
	Tiers                map[string]HuntTierOverride `json:"tiers,omitempty"`
	// MinTierSortOrder — if set, player must have vip_tiers.sort_order >= this (0-based rank) to participate.
	MinTierSortOrder *int `json:"min_tier_sort_order,omitempty"`
}

func loadRewardPrograms(ctx context.Context, pool *pgxpool.Pool, kind *RewardProgramKind) ([]RewardProgram, error) {
	const base = `
		SELECT id, program_key, kind, promotion_version_id, config, enabled, priority
		FROM reward_programs WHERE enabled = true`
	var rows pgx.Rows
	var err error
	if kind == nil {
		rows, err = pool.Query(ctx, base+` ORDER BY priority DESC, id ASC`)
	} else {
		rows, err = pool.Query(ctx, base+` AND kind = $1 ORDER BY priority DESC, id ASC`, string(*kind))
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RewardProgram
	for rows.Next() {
		var p RewardProgram
		var k string
		if err := rows.Scan(&p.ID, &p.ProgramKey, &k, &p.PromotionVersionID, &p.Config, &p.Enabled, &p.Priority); err != nil {
			continue
		}
		p.Kind = RewardProgramKind(k)
		out = append(out, p)
	}
	return out, nil
}

func parseDailyConfig(raw json.RawMessage) (DailyFixedConfig, error) {
	var c DailyFixedConfig
	if len(raw) == 0 {
		return c, nil
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	return c, nil
}

func parseRebateConfig(raw json.RawMessage) (RebateConfig, error) {
	var c RebateConfig
	if len(raw) == 0 {
		return c, nil
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	if c.Period == "" {
		c.Period = "daily"
	}
	return c, nil
}

func parseHuntConfig(raw json.RawMessage) (HuntConfig, error) {
	var c HuntConfig
	if len(raw) == 0 {
		return c, nil
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	return c, nil
}

// UTCDate returns YYYY-MM-DD for t in UTC.
func UTCDate(t time.Time) string {
	u := t.UTC()
	return u.Format("2006-01-02")
}

func parseUTCDate(s string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02", s, time.UTC)
}
