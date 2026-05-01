package bonus

import "testing"

func TestNextClaimableHuntMilestoneIndex(t *testing.T) {
	thr := []int64{100, 500, 1000}

	if idx, ok := nextClaimableHuntMilestoneIndex(thr, -1, 99); ok || idx != 0 {
		t.Fatalf("expected next index 0 not claimable, got idx=%d ok=%v", idx, ok)
	}
	if idx, ok := nextClaimableHuntMilestoneIndex(thr, -1, 100); !ok || idx != 0 {
		t.Fatalf("expected first claimable at 0, got idx=%d ok=%v", idx, ok)
	}
	if idx, ok := nextClaimableHuntMilestoneIndex(thr, 1, 800); ok || idx != 2 {
		t.Fatalf("expected next index 2 not claimable, got idx=%d ok=%v", idx, ok)
	}
	if idx, ok := nextClaimableHuntMilestoneIndex(thr, 2, 2000); ok || idx != -1 {
		t.Fatalf("expected no next index, got idx=%d ok=%v", idx, ok)
	}
}
