package ledger

// Playable ledger pockets (BlueOcean balance = cash + bonus_locked).
const (
	PocketCash                  = "cash"
	PocketBonusLocked           = "bonus_locked"
	PocketPendingWithdrawal     = "pending_withdrawal"
	// House ledger user only — mirrors inbound custody / outbound settlement for reconciliation (double-entry companion legs).
	PocketClearingDeposit       = "clearing_deposit"
	PocketClearingWithdrawalOut = "clearing_withdrawal_out"
)

// NormalizePocket returns a valid pocket name; empty defaults to cash.
func NormalizePocket(p string) string {
	switch p {
	case PocketBonusLocked:
		return PocketBonusLocked
	case PocketPendingWithdrawal:
		return PocketPendingWithdrawal
	case PocketClearingDeposit:
		return PocketClearingDeposit
	case PocketClearingWithdrawalOut:
		return PocketClearingWithdrawalOut
	default:
		return PocketCash
	}
}
