package bonus

import "testing"

func TestInstanceStatusBlocksHubIntentSynthetic(t *testing.T) {
	if !InstanceStatusBlocksHubIntentSynthetic("active") {
		t.Fatal("active should block")
	}
	if !InstanceStatusBlocksHubIntentSynthetic("PENDING") {
		t.Fatal("pending should block")
	}
	if InstanceStatusBlocksHubIntentSynthetic("forfeited") {
		t.Fatal("forfeited should not block")
	}
	if InstanceStatusBlocksHubIntentSynthetic("cancelled") {
		t.Fatal("cancelled should not block")
	}
}
