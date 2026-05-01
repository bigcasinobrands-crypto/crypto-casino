package bonus

import "testing"

func TestClampVipRebatePercentAdd(t *testing.T) {
	tests := []struct {
		in, want float64
	}{
		{-5, 0},
		{0, 0},
		{15, 15},
		{30, 30},
		{100, 30},
		{1.234, 1.23},
	}
	for _, tt := range tests {
		if g := clampVipRebatePercentAdd(tt.in); g != tt.want {
			t.Fatalf("clampVipRebatePercentAdd(%v)=%v want %v", tt.in, g, tt.want)
		}
	}
}
