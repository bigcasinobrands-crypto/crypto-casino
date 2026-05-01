package bonus

import (
	"encoding/json"
	"testing"
)

func TestMatchesDepositFirstAndNth(t *testing.T) {
	var r promoRules
	r.Trigger.Type = "deposit"
	ev := PaymentSettled{AmountMinor: 100, Channel: "hosted_checkout", DepositIndex: 2, FirstDeposit: false}
	if !r.matchesDeposit(ev) {
		t.Fatal("expected base deposit match")
	}
	r.Trigger.FirstDepositOnly = true
	if r.matchesDeposit(ev) {
		t.Fatal("expected first-only to reject second deposit")
	}
	r.Trigger.FirstDepositOnly = false
	r.Trigger.NthDeposit = 2
	if !r.matchesDeposit(ev) {
		t.Fatal("expected nth=2 to match second deposit")
	}
	r.Trigger.NthDeposit = 1
	if r.matchesDeposit(ev) {
		t.Fatal("expected nth=1 to reject deposit index 2")
	}
}

func TestMatchesDepositChannels(t *testing.T) {
	var r promoRules
	r.Trigger.Type = "deposit"
	r.Trigger.Channels = []string{"on_chain_deposit"}
	ev := PaymentSettled{AmountMinor: 50, Channel: "hosted_checkout"}
	if r.matchesDeposit(ev) {
		t.Fatal("expected channel mismatch")
	}
	ev.Channel = "on_chain_deposit"
	if !r.matchesDeposit(ev) {
		t.Fatal("expected channel match")
	}
}

func TestComputeGrantAmountPercentCap(t *testing.T) {
	var r promoRules
	r.Reward.Type = "percent_match"
	r.Reward.Percent = 100
	r.Reward.CapMinor = 5000
	if g := r.computeGrantAmount(3000); g != 3000 {
		t.Fatalf("expected 3000, got %d", g)
	}
	if g := r.computeGrantAmount(10000); g != 5000 {
		t.Fatalf("expected cap 5000, got %d", g)
	}
}

func TestWRRequired(t *testing.T) {
	var r promoRules
	r.Wagering.Multiplier = 10
	if r.wrRequired(1000) != 10000 {
		t.Fatalf("expected 10000, got %d", r.wrRequired(1000))
	}
}

func TestFreeSpinFromRules_rewardAndComposite(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"trigger":  map[string]any{"type": "deposit", "min_minor": 0},
		"reward":   map[string]any{"type": "freespins", "rounds": 10, "game_id": "g1", "bet_per_round_minor": 2},
		"wagering": map[string]any{"multiplier": 35, "max_bet_minor": 0, "game_weight_pct": 100},
	})
	var r promoRules
	if err := json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	rounds, bet, gid, ok := r.freeSpinFromRules()
	if !ok || rounds != 10 || bet != 2 || gid != "g1" {
		t.Fatalf("bad reward fs: %v %v %q %v", rounds, bet, gid, ok)
	}

	raw2, _ := json.Marshal(map[string]any{
		"trigger":  map[string]any{"type": "deposit", "min_minor": 0},
		"reward":   map[string]any{"type": "percent_match", "percent": 50, "cap_minor": 0},
		"free_spins": map[string]any{"rounds": 5, "game_id": "g2", "bet_per_round_minor": 0},
		"wagering": map[string]any{"multiplier": 35, "max_bet_minor": 0, "game_weight_pct": 100},
	})
	var r2 promoRules
	if err := json.Unmarshal(raw2, &r2); err != nil {
		t.Fatal(err)
	}
	rounds, bet, gid, ok = r2.freeSpinFromRules()
	if !ok || rounds != 5 || gid != "g2" {
		t.Fatalf("bad composite fs: %d %d %q %v", rounds, bet, gid, ok)
	}
}
