package blueocean

import (
	"encoding/json"
	"testing"
)

func TestPlayerExistsResponseOK(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{"false means not exists", `{"error":0,"response":false}`, false},
		{"true means exists", `{"error":0,"response":true}`, true},
		{"string no", `{"error":0,"response":"No"}`, false},
		{"string yes", `{"error":0,"response":"Yes"}`, true},
		{"top error non-zero", `{"error":1,"response":true}`, false},
		{"map with remote_id", `{"error":0,"response":{"remote_id":2167331}}`, true},
		{"empty response map", `{"error":0,"response":{}}`, false},
		{"missing response", `{"error":0}`, true},
		{"exists key false", `{"error":0,"response":{"exists":false,"currency":"EUR"}}`, false},
		{"exists key true", `{"error":0,"response":{"exists":true}}`, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var m map[string]any
			if err := json.Unmarshal([]byte(tc.raw), &m); err != nil {
				t.Fatal(err)
			}
			if got := playerExistsResponseOK(m); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestPlayerExistsTruth(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		wantEx   bool
		wantAPIR bool
	}{
		{"exists bool", `{"error":0,"response":true}`, true, true},
		{"not exists", `{"error":0,"response":false}`, false, true},
		{"api error", `{"error":1,"response":true}`, false, false},
		{"no response key", `{"error":0}`, false, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ex, apiOK := PlayerExistsTruth(json.RawMessage(tc.raw))
			if ex != tc.wantEx || apiOK != tc.wantAPIR {
				t.Fatalf("got exists=%v apiOK=%v want exists=%v apiOK=%v", ex, apiOK, tc.wantEx, tc.wantAPIR)
			}
		})
	}
}

func TestXapiResponseOKForMethodPlayerExists(t *testing.T) {
	raw := json.RawMessage(`{"error":0,"response":false}`)
	if xapiResponseOKForMethod("playerExists", 200, raw) {
		t.Fatal("expected playerExists scalar false → not OK")
	}
	if !xapiResponseOKForMethod("getGameList", 200, raw) {
		t.Fatal("other methods keep legacy interpretation for same body")
	}
}
