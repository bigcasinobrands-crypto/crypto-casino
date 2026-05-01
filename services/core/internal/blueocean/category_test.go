package blueocean

import "testing"

func TestPrimaryLobbyKey(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"live-casino-table", "live"},
		{"live-casino", "live"},
		{"slots", "slots"},
		{"slot", "slots"},
		{"video-slots", "slots"},
		{"video-slot-mega", "slots"},
		{"live", "live"},
		{"table-games", "table"},
		{"crash-games", "crash"},
		{"something-unknown", "other"},
	}
	for _, tt := range tests {
		if got := PrimaryLobbyKey(tt.in); got != tt.want {
			t.Errorf("PrimaryLobbyKey(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestLobbyCategory(t *testing.T) {
	tests := []struct {
		gameType    string
		subcategory string
		want        string
	}{
		{"", "", "other"},
		{"casino", "slots", "slots"},
		{"", "roulette", "table"},
		{"", "megaways", "slots"},
		{"rng-slots", "", "slots"},
		{"rng-roulette", "", "table"},
		{"live-casino", "blackjack", "live"},
		{"", "live-roulette", "live"},
		{"jackpot-slots", "", "slots"},
		{"virtual-sports", "", "sports"},
		{"scratch-cards", "", "scratch"},
		{"bingo", "", "lottery"},
		{"live-bingo", "", "live"},
	}
	for _, tt := range tests {
		if got := LobbyCategory(tt.gameType, tt.subcategory); got != tt.want {
			t.Errorf("LobbyCategory(%q, %q) = %q, want %q", tt.gameType, tt.subcategory, got, tt.want)
		}
	}
}
