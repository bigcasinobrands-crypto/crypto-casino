package bonus

import "testing"

func TestRewardMinorToTokenAmountStable(t *testing.T) {
	got, err := rewardMinorToTokenAmount("USDT", 500, nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != "5.00" {
		t.Fatalf("expected 5.00, got %s", got)
	}
}

func TestRewardMinorToTokenAmountMissingTicker(t *testing.T) {
	_, err := rewardMinorToTokenAmount("BTC", 500, nil)
	if err == nil {
		t.Fatalf("expected error for non-stable without ticker")
	}
}
