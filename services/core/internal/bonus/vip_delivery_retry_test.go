package bonus

import (
	"testing"
	"time"
)

func TestVIPDeliveryWindowKeyStablePerUTCWindow(t *testing.T) {
	ws := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	k := vipDeliveryWindowKey(ws)
	k2 := vipDeliveryWindowKey(ws.Add(2 * time.Hour))
	if k != k2 {
		t.Fatalf("same UTC calendar window should share key: %q vs %q", k, k2)
	}
	if got := vipDeliveryWindowKey(ws.Add(25 * time.Hour)); got == k {
		t.Fatalf("next day should differ")
	}
}
