package bonus

import "testing"

func TestClampVipRebatePercentAdd(t *testing.T) {
	tests := []struct {
		in, want int
	}{
		{-5, 0},
		{0, 0},
		{15, 15},
		{30, 30},
		{100, 30},
	}
	for _, tt := range tests {
		if g := clampVipRebatePercentAdd(tt.in); g != tt.want {
			t.Fatalf("clampVipRebatePercentAdd(%d)=%d want %d", tt.in, g, tt.want)
		}
	}
}
