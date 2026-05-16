package raffle

import "testing"

func TestComputePurchaseCostMinor_fixed(t *testing.T) {
	pc := purchaseConfig{PricePerTicketMinor: 100}
	if got := computePurchaseCostMinor(pc, 0, 5); got != 500 {
		t.Fatalf("fixed: got %d", got)
	}
}

func TestComputePurchaseCostMinor_progressive(t *testing.T) {
	pc := purchaseConfig{PricePerTicketMinor: 100, EveryNBuckets: 2, PriceMultiplierNumerator: 2}
	if got := computePurchaseCostMinor(pc, 0, 4); got != 600 {
		t.Fatalf("prog from 0 x4: got %d want 600", got)
	}
}

func TestComputeTickets_floor(t *testing.T) {
	cfg := parseTicketRates([]byte(`{"casino":{"threshold_minor":100,"tickets_per_threshold":1}}`))
	if n := computeTickets("casino", 250, cfg); n != 2 {
		t.Fatalf("casino tickets: got %d", n)
	}
}
