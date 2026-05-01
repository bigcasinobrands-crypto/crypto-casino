package ledger

import "testing"

// Documents floor-at-zero behavior mirrored in SumSuccessfulCashStakeForWindow.
func TestSuccessfulCashStakeNetFloorsAtZero(t *testing.T) {
	gross, roll := int64(50), int64(80)
	n := gross - roll
	if n < 0 {
		n = 0
	}
	if n != 0 {
		t.Fatalf("expected 0, got %d", n)
	}
}
