package wallet

import "testing"

// Product contract (player VipPage):
//   - Tier ladder numbers: GET /v1/vip/status (VIPStatusMap in vip.go).
//   - Daily Dollar Hunt: GET /v1/rewards/hub "hunt" (GetHuntStatus in bonus).
// The hub response also includes a "vip" object from the same VIPStatusMap — it must stay aligned
// with /v1/vip/status; the UI uses the status endpoint for the tier strip to avoid double-fetch drift.
func TestVipPageContractDocumented(t *testing.T) {
	t.Helper()
	t.Log("Parity: hub vip key uses VIPStatusMap; tier UI should prefer GET /v1/vip/status for the progress card.")
}
