package bonus

import "testing"

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
