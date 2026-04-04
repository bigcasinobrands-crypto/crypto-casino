package blueocean

import (
	"strconv"
	"strings"
)

// PrimaryLobbyKey maps BOG `type` strings to lobby filter keys (slots, live, table, …).
// BOG uses variants like "live-casino-table" — normalize by prefix / family.
func PrimaryLobbyKey(gameType string) string {
	gt := strings.ToLower(strings.TrimSpace(gameType))
	switch {
	case gt == "live-casino" || strings.HasPrefix(gt, "live-casino"):
		return "live"
	case gt == "video-slots" || strings.HasPrefix(gt, "video-slot"):
		return "slots"
	case gt == "table-games" || gt == "video-poker":
		return "table"
	case gt == "sportsbook" || gt == "virtual-sports":
		return "sports"
	case gt == "crash-games" || strings.HasPrefix(gt, "crash"):
		return "crash"
	case gt == "scratch-cards" || strings.Contains(gt, "scratch"):
		return "scratch"
	case strings.Contains(gt, "lottery") || strings.Contains(gt, "bingo"):
		return "lottery"
	default:
		return "other"
	}
}

// StableGameID returns DB primary key for catalog row.
func StableGameID(g CatalogGame) string {
	if g.IDHash != "" {
		return g.IDHash
	}
	return "bog:" + strconv.FormatInt(g.BogID, 10)
}
