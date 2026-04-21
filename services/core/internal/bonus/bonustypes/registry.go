// Package bonustypes defines built-in bonus engine families for the operator console and compile step.
package bonustypes

// ID values are stable API contract for promotion_versions.bonus_type and admin UI.
const (
	DepositMatch          = "deposit_match"
	ReloadDeposit         = "reload_deposit"
	FreeSpinsOnly         = "free_spins_only"
	CompositeMatchAndFS   = "composite_match_and_fs"
	CashbackNetLoss       = "cashback_net_loss"
	WagerRebate           = "wager_rebate"
	NoDeposit             = "no_deposit"
	Custom                = "custom"
)

// Entry describes one selectable type in the Bonus Engine console.
type Entry struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// All lists every built-in type (order is display order).
func All() []Entry {
	return []Entry{
		{ID: DepositMatch, Label: "Deposit match", Description: "Percentage or fixed match on a qualifying deposit (welcome, reload, Nth deposit)."},
		{ID: ReloadDeposit, Label: "Reload bonus", Description: "Deposit match scoped to retention / time windows."},
		{ID: FreeSpinsOnly, Label: "Free spins only", Description: "Free spins package; fulfillment via game provider (e.g. BlueOcean)."},
		{ID: CompositeMatchAndFS, Label: "Match + free spins", Description: "Combined deposit match and free spins in one offer."},
		{ID: CashbackNetLoss, Label: "Cashback (net loss)", Description: "Scheduled % of net losses over a period (daily/weekly)."},
		{ID: WagerRebate, Label: "Wager / turnover rebate", Description: "Scheduled % of total wager volume over a period."},
		{ID: NoDeposit, Label: "No-deposit / registration", Description: "Small credit or spins without deposit; strict abuse controls."},
		{ID: Custom, Label: "Custom (advanced)", Description: "Raw rules JSON for edge cases; prefer specific types when possible."},
	}
}

// Valid reports whether id is a known built-in type (empty id is allowed = unset).
func Valid(id string) bool {
	if id == "" {
		return true
	}
	for _, e := range All() {
		if e.ID == id {
			return true
		}
	}
	return false
}
