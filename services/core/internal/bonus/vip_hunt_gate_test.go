package bonus

import "testing"

func TestHuntParticipationGate_DefaultOpen(t *testing.T) {
	cfg := HuntConfig{}
	ok, reason := HuntParticipationGate(cfg, -1, false)
	if !ok || reason != "" {
		t.Fatalf("expected open gate, got ok=%v reason=%q", ok, reason)
	}
}

func TestEffectiveHuntCurve_Fallback(t *testing.T) {
	cfg := HuntConfig{
		ThresholdsWagerMinor: []int64{100},
		AmountsMinor:         []int64{50},
	}
	a, b := EffectiveHuntCurve(cfg, nil)
	if len(a) != 1 || a[0] != 100 || len(b) != 1 || b[0] != 50 {
		t.Fatal(a, b)
	}
}
