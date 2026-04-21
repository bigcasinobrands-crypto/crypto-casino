package bonus

import "testing"

func TestEffectiveRebatePercent(t *testing.T) {
	tests := []struct {
		base, add, want int
	}{
		{5, 0, 5},
		{5, 10, 15},
		{90, 20, 100},
		{0, 0, 0},
		{10, -20, 0},
	}
	for _, tt := range tests {
		if g := effectiveRebatePercent(tt.base, tt.add); g != tt.want {
			t.Fatalf("effectiveRebatePercent(%d,%d)=%d want %d", tt.base, tt.add, g, tt.want)
		}
	}
}
