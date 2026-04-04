package blueocean

import "strconv"

// PrimaryLobbyKey maps BOG type to sidebar / filter keys.
func PrimaryLobbyKey(gameType string) string {
	switch gameType {
	case "video-slots":
		return "slots"
	case "live-casino":
		return "live"
	case "table-games", "video-poker":
		return "table"
	case "sportsbook", "virtual-sports":
		return "sports"
	case "crash-games":
		return "crash"
	case "scratch-cards":
		return "scratch"
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
