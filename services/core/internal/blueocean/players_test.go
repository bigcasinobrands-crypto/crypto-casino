package blueocean

import (
	"encoding/json"
	"testing"
)

func TestBoDisplayUsername(t *testing.T) {
	if got := boDisplayUsername("alice", "", "550e8400-e29b-41d4-a716-446655440000"); got != "alice" {
		t.Fatalf("username: got %q", got)
	}
	if got := boDisplayUsername("", "Bob@Example.com", ""); got != "bob" {
		t.Fatalf("email local: got %q", got)
	}
	if got := boDisplayUsername("", "", "550E8400-E29B-41D4-A716-446655440000"); got != "player_550e8400" {
		t.Fatalf("fallback: got %q", got)
	}
}

func TestExtractCreatePlayerRemoteID(t *testing.T) {
	raw := json.RawMessage(`{"error":0,"response":{"remote_id":2167331}}`)
	if got := extractCreatePlayerRemoteID(raw); got != "2167331" {
		t.Fatalf("got %q", got)
	}
}

func TestCreatePlayerIndicatesAlreadyExists(t *testing.T) {
	raw := json.RawMessage(`{"error":1,"message":"Player already exists"}`)
	if !createPlayerIndicatesAlreadyExists(raw, 400) {
		t.Fatal("expected already exists")
	}
}

func TestMergePlayerParamMap(t *testing.T) {
	dst := map[string]any{"userid": "1", "user_username": "a"}
	mergePlayerParamMap(dst, map[string]any{
		"user_username": "b",
		"empty":         "",
		"nil":           nil,
		"extra":         "x",
	})
	if dst["user_username"] != "b" {
		t.Fatalf("override: %v", dst["user_username"])
	}
	if _, has := dst["empty"]; has {
		t.Fatal("expected empty string skipped")
	}
	if dst["extra"] != "x" {
		t.Fatal("expected extra")
	}
}
