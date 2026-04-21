package ledger

// Playable ledger pockets (BlueOcean balance = cash + bonus_locked).
const (
	PocketCash        = "cash"
	PocketBonusLocked = "bonus_locked"
)

// NormalizePocket returns a valid pocket name; empty defaults to cash.
func NormalizePocket(p string) string {
	switch p {
	case PocketBonusLocked:
		return PocketBonusLocked
	default:
		return PocketCash
	}
}
