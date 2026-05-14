package adminops

import "testing"

func TestNgrTotalFromBreakdown(t *testing.T) {
	t.Parallel()
	b := dashboardNGRBreakdown{
		GGR:                 10_000,
		BonusCost:           1_000,
		CashbackPaid:        200,
		RakebackPaid:        300,
		VipRewardsPaid:      100,
		AffiliateCommission: 50,
		JackpotCosts:        0,
		PaymentProviderFees: 400,
		ManualAdjustments:   150,
	}
	want := int64(10_000 - 1000 - 200 - 300 - 100 - 50 - 0 - 400 - 150)
	if got := ngrTotalFromBreakdown(b); got != want {
		t.Fatalf("ngrTotalFromBreakdown = %d want %d", got, want)
	}
}

func TestNgrTotalFromBreakdownZeroGGR(t *testing.T) {
	t.Parallel()
	b := dashboardNGRBreakdown{
		GGR:               0,
		BonusCost:         0,
		PaymentProviderFees: 100,
	}
	if got := ngrTotalFromBreakdown(b); got != -100 {
		t.Fatalf("expected -100 with zero GGR and fees, got %d", got)
	}
}

func TestNgrTotalFromBreakdownNoCostsEqualsGGR(t *testing.T) {
	t.Parallel()
	b := dashboardNGRBreakdown{GGR: 5_000}
	if got := ngrTotalFromBreakdown(b); got != 5_000 {
		t.Fatalf("got %d", got)
	}
}

func TestNgrBreakdownGGR900AfterCosts(t *testing.T) {
	t.Parallel()
	b := dashboardNGRBreakdown{
		SettledBetsMinor: 1000,
		SettledWinsMinor: 0,
		GGR:              1000,
		BonusCost:        100,
	}
	if got := ngrTotalFromBreakdown(b); got != 900 {
		t.Fatalf("NGR = %d want 900", got)
	}
}

func TestNgrBreakdownDepositsOmittedFromFormula(t *testing.T) {
	t.Parallel()
	// Deposits never enter dashboardNGRBreakdown struct; GGR is ledger-mapped only.
	b := dashboardNGRBreakdown{GGR: 100, BonusCost: 0}
	if ngrTotalFromBreakdown(b) != 100 {
		t.Fatal("unexpected NGR drift")
	}
}

func TestNgrBreakdownJSONMatchesFormula(t *testing.T) {
	t.Parallel()
	b := dashboardNGRBreakdown{
		GGR:            2_000,
		BonusCost:      500,
		RakebackPaid:   100,
		CashbackPaid:   50,
		VipRewardsPaid: 25,
	}
	m := ngrBreakdownJSON(b)
	ggr, _ := m["ggr"].(int64)
	ngr, _ := m["ngr_total"].(int64)
	if ggr != 2_000 {
		t.Fatalf("ggr in map: %v", m["ggr"])
	}
	if ngr != ngrTotalFromBreakdown(b) {
		t.Fatalf("ngr_total in map doesn't match formula")
	}
}
