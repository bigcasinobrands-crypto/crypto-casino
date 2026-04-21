package bonus

import (
	"encoding/json"
	"strings"
)

type promoRules struct {
	Trigger struct {
		Type             string   `json:"type"`
		MinMinor         int64    `json:"min_minor"`
		MaxMinor         int64    `json:"max_minor"`
		FirstDepositOnly bool     `json:"first_deposit_only"`
		NthDeposit       int      `json:"nth_deposit"` // e.g. 2 = second deposit only; 0 = any
		Channels         []string `json:"channels"`    // empty = any; else must match ev.Channel
	} `json:"trigger"`
	Reward struct {
		Type       string `json:"type"`
		Percent    int    `json:"percent"`
		CapMinor   int64  `json:"cap_minor"`
		FixedMinor int64  `json:"fixed_minor"`
	} `json:"reward"`
	Wagering struct {
		Multiplier    int     `json:"multiplier"`
		MaxBetMinor   int64   `json:"max_bet_minor"`
		GameWeightPct int     `json:"game_weight_pct"`
	} `json:"wagering"`
	WithdrawPolicy  string   `json:"withdraw_policy"`
	ExcludedGameIDs []string `json:"excluded_game_ids"`
}

func parseRules(raw []byte) (promoRules, error) {
	var r promoRules
	if len(raw) == 0 {
		return r, nil
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return r, err
	}
	if r.Wagering.GameWeightPct <= 0 {
		r.Wagering.GameWeightPct = 100
	}
	if r.Wagering.Multiplier <= 0 {
		r.Wagering.Multiplier = 30
	}
	if r.WithdrawPolicy == "" && strings.EqualFold(strings.TrimSpace(r.Trigger.Type), "deposit") {
		if r.Reward.Percent > 0 || r.Reward.FixedMinor > 0 || strings.TrimSpace(r.Reward.Type) != "" {
			r.WithdrawPolicy = "block"
		}
	}
	return r, nil
}

func (r promoRules) matchesDeposit(ev PaymentSettled) bool {
	if strings.TrimSpace(strings.ToLower(r.Trigger.Type)) != "deposit" {
		return false
	}
	amt := ev.AmountMinor
	if r.Trigger.MinMinor > 0 && amt < r.Trigger.MinMinor {
		return false
	}
	if r.Trigger.MaxMinor > 0 && amt > r.Trigger.MaxMinor {
		return false
	}
	if r.Trigger.FirstDepositOnly && !ev.FirstDeposit {
		return false
	}
	if r.Trigger.NthDeposit > 0 && ev.DepositIndex != int64(r.Trigger.NthDeposit) {
		return false
	}
	if len(r.Trigger.Channels) > 0 {
		ch := strings.TrimSpace(strings.ToLower(ev.Channel))
		ok := false
		for _, c := range r.Trigger.Channels {
			if strings.TrimSpace(strings.ToLower(c)) == ch {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func (r promoRules) computeGrantAmount(depositMinor int64) int64 {
	switch strings.ToLower(strings.TrimSpace(r.Reward.Type)) {
	case "percent_match", "percent", "":
		if r.Reward.Percent <= 0 {
			return 0
		}
		v := (depositMinor * int64(r.Reward.Percent)) / 100
		if r.Reward.CapMinor > 0 && v > r.Reward.CapMinor {
			v = r.Reward.CapMinor
		}
		return v
	case "fixed", "fixed_amount":
		return r.Reward.FixedMinor
	default:
		return 0
	}
}

func (r promoRules) wrRequired(grantMinor int64) int64 {
	if grantMinor <= 0 {
		return 0
	}
	return grantMinor * int64(r.Wagering.Multiplier)
}

func (r promoRules) gameExcluded(gameID string) bool {
	g := strings.TrimSpace(strings.ToLower(gameID))
	if g == "" {
		return false
	}
	for _, x := range r.ExcludedGameIDs {
		if strings.TrimSpace(strings.ToLower(x)) == g {
			return true
		}
	}
	return false
}
