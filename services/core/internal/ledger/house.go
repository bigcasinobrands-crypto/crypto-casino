package ledger

import (
	"strings"

	"github.com/crypto-casino/core/internal/config"
)

// DefaultHouseUserID is the seeded synthetic user for house clearing legs (see migration 00069).
const DefaultHouseUserID = "00000000-0000-4000-a000-000000000001"

// HouseUserID returns the ledger house UUID used for clearing/inbound/outbound mirror postings.
func HouseUserID(cfg *config.Config) string {
	if cfg != nil {
		if s := strings.TrimSpace(cfg.LedgerHouseUserID); s != "" {
			return s
		}
	}
	return DefaultHouseUserID
}
