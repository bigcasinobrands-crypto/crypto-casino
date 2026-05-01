package bonus

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// HubOfferDetailsMap builds disclosure fields for GET /v1/rewards/hub available_offers (wagering, games, audience).
func HubOfferDetailsMap(ctx context.Context, pool *pgxpool.Pool, versionID int64, rulesJSON []byte) map[string]any {
	rules, err := parseRules(rulesJSON)
	if err != nil {
		return nil
	}
	out := map[string]any{}
	if rules.Wagering.Multiplier > 0 {
		out["wagering_multiplier"] = rules.Wagering.Multiplier
	}
	if rules.Wagering.MaxBetMinor > 0 {
		out["max_bet_minor"] = rules.Wagering.MaxBetMinor
	}
	if rules.Wagering.GameWeightPct > 0 && rules.Wagering.GameWeightPct != 100 {
		out["game_weight_pct"] = rules.Wagering.GameWeightPct
	}
	if wp := strings.TrimSpace(rules.WithdrawPolicy); wp != "" {
		out["withdraw_policy"] = wp
	}
	if len(rules.ExcludedGameIDs) > 0 {
		out["excluded_game_ids"] = rules.ExcludedGameIDs
	}
	if len(rules.AllowedGameIDs) > 0 {
		out["allowed_game_ids"] = rules.AllowedGameIDs
	}

	var wrap struct {
		Segment struct {
			VIPMinTier            int      `json:"vip_min_tier"`
			Tags                  []string `json:"tags"`
			CountryAllow          []string `json:"country_allow"`
			CountryDeny           []string `json:"country_deny"`
			ExplicitTargetingOnly bool     `json:"explicit_targeting_only"`
		} `json:"segment"`
	}
	_ = json.Unmarshal(rulesJSON, &wrap)
	seg := wrap.Segment

	aud := map[string]any{}
	if rules.Trigger.FirstDepositOnly {
		aud["first_deposit_only"] = true
	}
	if rules.Trigger.NthDeposit > 0 {
		aud["nth_deposit"] = rules.Trigger.NthDeposit
	}
	if rules.Trigger.MinMinor > 0 {
		aud["min_deposit_minor"] = rules.Trigger.MinMinor
	}
	if rules.Trigger.MaxMinor > 0 {
		aud["max_deposit_minor"] = rules.Trigger.MaxMinor
	}
	if len(rules.Trigger.Channels) > 0 {
		aud["deposit_channels"] = rules.Trigger.Channels
	}
	if seg.VIPMinTier > 0 {
		aud["vip_min_tier"] = seg.VIPMinTier
	}
	if len(seg.CountryAllow) > 0 {
		aud["country_allow"] = seg.CountryAllow
	}
	if len(seg.CountryDeny) > 0 {
		aud["country_deny"] = seg.CountryDeny
	}
	if len(seg.Tags) > 0 {
		aud["tags"] = seg.Tags
	}
	hasTargets, _ := versionUsesExplicitTargets(ctx, pool, versionID)
	if hasTargets || seg.ExplicitTargetingOnly {
		aud["invitation_or_target_list"] = true
	}
	if len(aud) > 0 {
		out["audience"] = aud
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
