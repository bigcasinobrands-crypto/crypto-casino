package blueocean

import (
	"strconv"
	"strings"
)

// LobbyCategory maps Blue Ocean catalog `type` + optional `subcategory` to the
// `games.category` column used by the player API (?category=slots|live|…).
// Subcategory is used when `type` is generic (e.g. empty, "casino") but
// subcategory names the vertical (roulette, slots, …).
func LobbyCategory(gameType, subcategory string) string {
	gt := strings.ToLower(strings.TrimSpace(gameType))
	sc := strings.ToLower(strings.TrimSpace(subcategory))
	combined := strings.TrimSpace(gt + " " + sc)
	if combined == "" {
		return "other"
	}

	if isLiveCategory(gt, combined) {
		return "live"
	}
	if isSportsCategory(gt, combined) {
		return "sports"
	}
	if isCrashCategory(gt, combined) {
		return "crash"
	}
	if isScratchCategory(gt, combined) {
		return "scratch"
	}
	if isLotteryCategory(gt, combined) {
		return "lottery"
	}
	if isSlotsCategory(gt, sc, combined) {
		return "slots"
	}
	if isTableCategory(gt, combined) {
		return "table"
	}
	return "other"
}

// PrimaryLobbyKey maps BOG `type` strings to lobby filter keys (slots, live, table, …).
// BOG uses variants like "live-casino-table" — normalize by prefix / family.
// Deprecated for new code: prefer LobbyCategory(gameType, subcategory).
func PrimaryLobbyKey(gameType string) string {
	return LobbyCategory(gameType, "")
}

func isLiveCategory(gt, combined string) bool {
	if gt == "live" || gt == "live-casino" || strings.HasPrefix(gt, "live-casino") {
		return true
	}
	for _, p := range []string{
		"live dealer", "live-dealer", "live roulette", "live-roulette",
		"live blackjack", "live-blackjack", "live baccarat", "live-baccarat",
		"live poker", "live-poker", "live sic", "live sicbo", "live sic-bo",
		"live craps", "live-craps", "live bingo", "live-bingo",
		"live game show", "live-game-show", "live wheel", "live-wheel",
		"live monopoly", "live-dream", "live football", "live-football",
		"game shows", "game-shows",
	} {
		if strings.Contains(combined, p) {
			return true
		}
	}
	return false
}

func isSportsCategory(gt, combined string) bool {
	if gt == "sportsbook" || gt == "virtual-sports" || strings.HasPrefix(gt, "virtual-sport") || gt == "sports" {
		return true
	}
	for _, p := range []string{
		"virtual sport", "virtual-sport", "virtual football", "virtual-football",
		"virtual racing", "virtual-racing", "sportsbook",
	} {
		if strings.Contains(combined, p) {
			return true
		}
	}
	return false
}

func isCrashCategory(gt, combined string) bool {
	if gt == "crash-games" || strings.HasPrefix(gt, "crash") || gt == "crash" {
		return true
	}
	return strings.Contains(combined, "crash-games") || strings.Contains(combined, "crash games")
}

func isScratchCategory(gt, combined string) bool {
	return strings.Contains(gt, "scratch") || strings.Contains(combined, "scratch")
}

func isLotteryCategory(gt, combined string) bool {
	if strings.Contains(gt, "lottery") || strings.Contains(combined, "lottery") {
		return true
	}
	if strings.Contains(combined, "keno") {
		return true
	}
	if (strings.Contains(gt, "bingo") || strings.Contains(combined, "bingo")) && !strings.Contains(combined, "live") {
		return true
	}
	return false
}

func isTableCategory(gt, combined string) bool {
	if gt == "table-games" || gt == "video-poker" || gt == "table" {
		return true
	}
	if gt == "rng" || strings.HasPrefix(gt, "rng-") {
		if strings.Contains(gt, "slot") {
			return false
		}
		return true
	}
	for _, p := range []string{
		"table-games", "table games", "video poker", "video-poker",
		"rng blackjack", "rng-blackjack", "rng roulette", "rng-roulette",
		"rng baccarat", "rng-baccarat", "american roulette", "european roulette",
		"french roulette", "mini roulette", "roulette",
		"blackjack", "baccarat", "craps", "sicbo", "sic-bo", "sic bo",
		"dragon tiger", "dragon-tiger", "dragon-tigers",
		"caribbean stud", "three card poker", "casino hold",
		"pai gow", "pai-gow", "red dog", "war",
		"hi-lo", "hilo", "hi lo", "teen patti",
	} {
		if strings.Contains(combined, p) {
			return true
		}
	}
	return false
}

func isSlotsCategory(gt, sc, combined string) bool {
	switch gt {
	case "slots", "slot", "video-slots":
		return true
	default:
		if strings.HasPrefix(gt, "video-slot") {
			return true
		}
	}
	if strings.Contains(gt, "megaways") || strings.Contains(sc, "megaways") || strings.Contains(combined, "megaways") {
		return true
	}
	for _, p := range []string{
		"classic-slot", "classic slot", "fruit-slot", "fruit slot",
		"jackpot-slot", "jackpot slot", "video-slot", "video slot",
		"must-drop", "must drop", "cascading", "cluster",
	} {
		if strings.Contains(combined, p) {
			return true
		}
	}
	if strings.Contains(gt, "slot") || strings.Contains(sc, "slot") {
		return true
	}
	return false
}

// StableGameID returns DB primary key for catalog row.
func StableGameID(g CatalogGame) string {
	if g.IDHash != "" {
		return g.IDHash
	}
	return "bog:" + strconv.FormatInt(g.BogID, 10)
}
