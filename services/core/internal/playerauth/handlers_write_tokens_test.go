package playerauth

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/crypto-casino/core/internal/config"
)

func TestWriteTokens_includesAccessAndRefreshInJSONByDefault(t *testing.T) {
	rec := httptest.NewRecorder()
	cfg := &config.Config{
		AppEnv:               "development",
		PlayerCookieAuth:     true,
		PlayerCookieSameSite: "lax",
	}
	h := &Handler{CookieCfg: cfg}
	const access = "test-access-jwt"
	const refresh = "test-refresh-jwt"
	const exp int64 = 1_700_000_000

	writeTokens(rec, h, access, refresh, exp)

	var body map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&body); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	if got, _ := body["access_token"].(string); got != access {
		t.Fatalf("access_token: got %q want %q", got, access)
	}
	if got, _ := body["refresh_token"].(string); got != refresh {
		t.Fatalf("refresh_token: got %q want %q", got, refresh)
	}
	if v, ok := body["expires_at"].(float64); !ok || int64(v) != exp {
		t.Fatalf("expires_at: got %v want %d", body["expires_at"], exp)
	}
	setCookie := rec.Result().Header.Values("Set-Cookie")
	if len(setCookie) == 0 {
		t.Fatal("expected Set-Cookie headers when PlayerCookieAuth")
	}
	var sawAccess bool
	for _, c := range setCookie {
		if strings.HasPrefix(c, "cc_player_access=") {
			sawAccess = true
			if !strings.Contains(c, access) {
				t.Fatalf("access cookie should contain jwt: %q", c)
			}
		}
	}
	if !sawAccess {
		t.Fatalf("expected cc_player_access in Set-Cookie: %#v", setCookie)
	}
}

func TestWriteTokens_omitsAccessAndRefreshFromJSONWhenConfigured(t *testing.T) {
	rec := httptest.NewRecorder()
	cfg := &config.Config{
		AppEnv:                     "development",
		PlayerCookieAuth:           true,
		PlayerCookieOmitJSONTokens: true,
		PlayerCookieSameSite:       "lax",
	}
	h := &Handler{CookieCfg: cfg}
	writeTokens(rec, h, "secret-access", "secret-refresh", 1_700_000_000)

	var body map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&body); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	if _, has := body["access_token"]; has {
		t.Fatalf("access_token should be omitted, got %#v", body["access_token"])
	}
	if _, has := body["refresh_token"]; has {
		t.Fatalf("refresh_token should be omitted, got %#v", body["refresh_token"])
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "secret-access") || strings.Contains(string(raw), "secret-refresh") {
		t.Fatalf("json body must not contain raw jwt: %s", raw)
	}
	if body["token_type"] != "Bearer" {
		t.Fatalf("token_type: got %v", body["token_type"])
	}
	if v, ok := body["expires_at"].(float64); !ok || int64(v) != 1_700_000_000 {
		t.Fatalf("expires_at: got %v", body["expires_at"])
	}
}
