package blueocean

import (
	"strings"
	"testing"
)

func TestFormEncode_boolsAreOneZero(t *testing.T) {
	s := formEncode(map[string]any{
		"api_login":       "u",
		"api_password":    "p",
		"method":          "getGameList",
		"show_additional": true,
		"playforfun":      false,
	})
	if !strings.Contains(s, "show_additional=1") {
		t.Fatalf("expected show_additional=1, got %q", s)
	}
	if !strings.Contains(s, "playforfun=0") {
		t.Fatalf("expected playforfun=0, got %q", s)
	}
}
