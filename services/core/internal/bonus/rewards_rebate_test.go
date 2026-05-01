package bonus

import "testing"

func TestEffectiveRebatePercentClamp(t *testing.T) {
	tests := []struct {
		base float64
		add  float64
		want float64
	}{
		{base: 10, add: 5, want: 15},
		{base: 90, add: 30, want: 100},
		{base: 0, add: -5, want: 0},
		{base: 1.2, add: 0.8, want: 2},
	}
	for _, tt := range tests {
		if got := effectiveRebatePercent(tt.base, tt.add); got != tt.want {
			t.Fatalf("effectiveRebatePercent(%v,%v)=%v want %v", tt.base, tt.add, got, tt.want)
		}
	}
}

func TestEffectiveRebatePercent(t *testing.T) {
	tests := []struct {
		base, add, want float64
	}{
		{5, 0, 5},
		{5, 10, 15},
		{90, 20, 100},
		{0, 0, 0},
		{10, -20, 0},
		{3.5, 1.2, 4.7},
	}
	for _, tt := range tests {
		if g := effectiveRebatePercent(tt.base, tt.add); g != tt.want {
			t.Fatalf("effectiveRebatePercent(%v,%v)=%v want %v", tt.base, tt.add, g, tt.want)
		}
	}
}
