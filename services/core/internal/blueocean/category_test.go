package blueocean

import "testing"

func TestPrimaryLobbyKey(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"live-casino-table", "live"},
		{"live-casino", "live"},
		{"video-slots", "slots"},
		{"video-slot-mega", "slots"},
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
