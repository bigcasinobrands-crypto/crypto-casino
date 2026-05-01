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
	// PlayerOptInGrantMinor (JSON player_opt_in_grant_minor): when >0 and promotion has hub boost,
	// POST /v1/bonuses/claim-offer can credit this amount without a deposit (e.g. starter balance).
	PlayerOptInGrantMinor int64 `json:"player_opt_in_grant_minor"`
	Reward struct {
		Type       string `json:"type"`
		Percent    int    `json:"percent"`
		CapMinor   int64  `json:"cap_minor"`
		FixedMinor int64  `json:"fixed_minor"`
		// Free spin packages (Blue Ocean addFreeRounds) when reward type is freespins / free_spins.
		Rounds           int    `json:"rounds"`
		GameID           string `json:"game_id"`
		BetPerRoundMinor int64  `json:"bet_per_round_minor"`
	} `json:"reward"`
	// FreeSpins: optional second package for composite_match_and_fs (match % from reward + free rounds).
	FreeSpins *struct {
		Rounds           int    `json:"rounds"`
		GameID           string `json:"game_id"`
		BetPerRoundMinor int64  `json:"bet_per_round_minor"`
	} `json:"free_spins"`
	Wagering struct {
		Multiplier    int     `json:"multiplier"`
		MaxBetMinor   int64   `json:"max_bet_minor"`
		GameWeightPct int     `json:"game_weight_pct"`
	} `json:"wagering"`
	WithdrawPolicy  string   `json:"withdraw_policy"`
	ExcludedGameIDs []string `json:"excluded_game_ids"`
	// AllowedGameIDs when non-empty: only these games count toward wagering (others do not progress WR).
	AllowedGameIDs []string `json:"allowed_game_ids"`
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

// matchesDeposit enforces this payment against trigger rules. It does not use the player’s
// pre-deposit cash balance; optional balance gates belong in the JSON rules if product adds them.
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

// freeSpinFromRules returns a Blue Ocean free-round package if rules specify rounds + a catalog game_id (our games.id / id_hash).
// Used to enqueue free_spin_grants (pending) for the worker to call addFreeRounds.
func (r promoRules) freeSpinFromRules() (rounds int, betPerRoundMinor int64, gameID string, ok bool) {
	if r.FreeSpins != nil && r.FreeSpins.Rounds > 0 {
		gid := strings.TrimSpace(r.FreeSpins.GameID)
		if gid == "" {
			return 0, 0, "", false
		}
		bet := r.FreeSpins.BetPerRoundMinor
		if bet <= 0 {
			bet = 1
		}
		return r.FreeSpins.Rounds, bet, gid, true
	}
	t := strings.ToLower(strings.TrimSpace(r.Reward.Type))
	if t == "freespins" || t == "free_spins" || t == "spins" {
		if r.Reward.Rounds <= 0 {
			return 0, 0, "", false
		}
		gid := strings.TrimSpace(r.Reward.GameID)
		if gid == "" {
			return 0, 0, "", false
		}
		bet := r.Reward.BetPerRoundMinor
		if bet <= 0 {
			bet = 1
		}
		return r.Reward.Rounds, bet, gid, true
	}
	return 0, 0, "", false
}

// notionalForFreeSpinRisk is a small cash-style figure for abuse / velocity checks on non-cash free-spin grants.
func notionalForFreeSpinRisk(rounds int, betPerRoundMinor int64) int64 {
	if rounds <= 0 {
		return 0
	}
	if betPerRoundMinor <= 0 {
		return int64(rounds * 100)
	}
	return int64(rounds) * betPerRoundMinor
}

func isDepositTrigger(r promoRules) bool {
	return strings.ToLower(strings.TrimSpace(r.Trigger.Type)) == "deposit"
}

// FreeSpinSpecFromRulesJSON extracts free-round parameters from a promotion version’s rules JSON (for admin / diagnostics).
func FreeSpinSpecFromRulesJSON(raw []byte) (rounds int, betPerRoundMinor int64, gameID string, ok bool, err error) {
	r, err := parseRules(raw)
	if err != nil {
		return 0, 0, "", false, err
	}
	rounds, betPerRoundMinor, gameID, ok = r.freeSpinFromRules()
	return rounds, betPerRoundMinor, gameID, ok, nil
}
