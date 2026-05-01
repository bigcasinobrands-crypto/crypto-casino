package blueocean

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAddFreeRoundsResponseOK_bogErrorZero(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"error": 0, "response": map[string]any{}})
	if !addFreeRoundsResponseOK(raw) {
		t.Fatal("expected ok")
	}
}

func TestAddFreeRoundsResponseOK_errorStringError(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"error": "bad"})
	if addFreeRoundsResponseOK(raw) {
		t.Fatal("expected fail")
	}
}

func TestExtractFreeRoundsProviderRef_nested(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"error": 0.0,
		"response": map[string]any{
			"free_rounds_id": "x-1",
		},
	})
	if s := extractFreeRoundsProviderRef(raw); s != "x-1" {
		t.Fatalf("ref=%q", s)
	}
}

func TestFormEncode_AvailableRoundsInAddFreeRounds(t *testing.T) {
	s := formEncode(map[string]any{"available": 20})
	if !strings.Contains(s, "available=20") {
		t.Fatalf("got %q", s)
	}
}
