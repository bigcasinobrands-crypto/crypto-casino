package blueocean

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/crypto-casino/core/internal/config"
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

func TestApplyUserUsernamePrefix(t *testing.T) {
	cfg := &config.Config{BlueOceanUserUsernamePrefix: "9w7r"}
	if got := applyUserUsernamePrefix(cfg, "Gogetamil"); got != "9w7rGogetamil" {
		t.Fatalf("got %q", got)
	}
	if got := applyUserUsernamePrefix(cfg, "9w7rGogetamil"); got != "9w7rGogetamil" {
		t.Fatalf("no double prefix: got %q", got)
	}
	if got := applyUserUsernamePrefix(nil, "x"); got != "x" {
		t.Fatalf("nil cfg: %q", got)
	}
	if got := applyUserUsernamePrefix(&config.Config{}, "y"); got != "y" {
		t.Fatalf("empty prefix: %q", got)
	}
}

func TestBoCreatePlayerUserUsernameMaxLen(t *testing.T) {
	const u = "550e8400e29b41d4a716446655440000"
	if got := boCreatePlayerUserUsername("shortname", u); got != "shortname" {
		t.Fatalf("short: %q", got)
	}
	long := strings.Repeat("a", 17)
	if got := boCreatePlayerUserUsername(long, u); got != u {
		t.Fatalf("long fallback: got %q want %q", got, u)
	}
	if got := boCreatePlayerUserUsername("", u); got != u {
		t.Fatalf("empty: %q", got)
	}
	if got := boCreatePlayerUserUsername("x", ""); got != "x" {
		t.Fatalf("empty xapi: %q", got)
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

func TestBuildCreatePlayerCallParamsIncludesEmail(t *testing.T) {
	uid := "550e8400-e29b-41d4-a716-446655440000"
	cfg := &config.Config{BlueOceanCurrency: "EUR"}
	params, sent, msg := buildCreatePlayerCallParams(cfg, CreatePlayerRequest{
		UserID: uid,
		Email:  "  Saeed@Example.com ",
	})
	if msg != "" {
		t.Fatal(msg)
	}
	if sent == "" {
		t.Fatal("expected user_username")
	}
	em, ok := params["email"].(string)
	if !ok || em != "Saeed@Example.com" {
		t.Fatalf("email param: got %q ok=%v map=%v", em, ok, params["email"])
	}
	params2, _, msg2 := buildCreatePlayerCallParams(cfg, CreatePlayerRequest{UserID: uid})
	if msg2 != "" {
		t.Fatal(msg2)
	}
	if _, has := params2["email"]; has {
		t.Fatalf("expected no email when req email empty: %v", params2)
	}
}

func TestBuildCreatePlayerCallParamsCustomerProfile(t *testing.T) {
	uid := "550e8400-e29b-41d4-a716-446655440000"
	cfg := &config.Config{BlueOceanCurrency: "EUR", BlueOceanAgentID: "12"}
	params, _, msg := buildCreatePlayerCallParams(cfg, CreatePlayerRequest{
		UserID:      uid,
		Username:    "alice",
		Email:       "a@b.co",
		FirstName:   "Ann",
		LastName:    "B",
		Nickname:    "alib",
		CountryISO2: "de",
		City:        "Berlin",
		Region:      "BE",
		Phone:       "+491234",
		Gender:      "F",
		Language:    "de",
		Birthday:    "1999-01-15",
	})
	if msg != "" {
		t.Fatal(msg)
	}
	if params["firstname"] != "Ann" || params["lastname"] != "B" || params["nickname"] != "alib" {
		t.Fatalf("name/nick: %v", params)
	}
	if params["country"] != "DE" || params["city"] != "Berlin" || params["region"] != "BE" {
		t.Fatalf("geo: %v", params)
	}
	if params["phone"] != "+491234" || params["gender"] != "f" || params["language"] != "de" {
		t.Fatalf("contact: %v", params)
	}
	if params["birthday"] != "1999-01-15" {
		t.Fatalf("birthday: %v", params["birthday"])
	}
}

func TestBoCustomerFromPreferencesJSON(t *testing.T) {
	raw := []byte(`{"first_name":"Jo","lastname":"X","phone":"+1","gender":"M","locale":"en-GB"}`)
	f, l, p, g, lang := boCustomerFromPreferencesJSON(raw)
	if f != "Jo" || l != "X" || p != "+1" || g != "M" || lang != "en" {
		t.Fatalf("got %q %q %q %q %q", f, l, p, g, lang)
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
