package config

import (
	"strings"
	"testing"
)

func TestLoad_omitJSONTokensRequiresCookieAuth(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("PLAYER_JWT_SECRET", "")
	t.Setenv("PLAYER_COOKIE_OMIT_JSON_TOKENS", "true")
	t.Setenv("PLAYER_COOKIE_AUTH", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when PLAYER_COOKIE_OMIT_JSON_TOKENS without PLAYER_COOKIE_AUTH")
	}
	if !strings.Contains(err.Error(), "PLAYER_COOKIE_OMIT_JSON_TOKENS") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoad_omitJSONTokensAllowedWithCookieAuth(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("PLAYER_JWT_SECRET", "")
	t.Setenv("PLAYER_COOKIE_OMIT_JSON_TOKENS", "true")
	t.Setenv("PLAYER_COOKIE_AUTH", "true")

	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !c.PlayerCookieOmitJSONTokens || !c.PlayerCookieAuth {
		t.Fatalf("expected both flags true, got omit=%v cookieAuth=%v", c.PlayerCookieOmitJSONTokens, c.PlayerCookieAuth)
	}
}

func TestValidateProduction_requiresRSAOrEscape(t *testing.T) {
	c := &Config{
		AppEnv:                    "production",
		JWTSecret:                 strings.Repeat("y", 32),
		RedisURL:                  "redis://localhost:6379",
		JWTRSAKeyFile:             "",
		AllowJWTHS256InProduction: false,
	}
	if err := c.ValidateProduction(); err == nil {
		t.Fatal("expected error without JWTRSAKeyFile")
	}
	c.JWTRSAKeyFile = "/path/to/key.pem"
	if err := c.ValidateProduction(); err != nil {
		t.Fatal(err)
	}
	c.JWTRSAKeyFile = ""
	c.AllowJWTHS256InProduction = true
	if err := c.ValidateProduction(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateProduction_requiresFingerprintSecretWhenMandatory(t *testing.T) {
	c := &Config{
		AppEnv:                       "production",
		JWTSecret:                    strings.Repeat("y", 32),
		RedisURL:                     "redis://localhost:6379",
		JWTRSAKeyFile:                "/path/to/key.pem",
		RequireFingerprintPlayerAuth: true,
		FingerprintSecretAPIKey:       "",
	}
	if err := c.ValidateProduction(); err == nil {
		t.Fatal("expected error when mandatory fingerprint lacks FINGERPRINT_SECRET_API_KEY")
	}
	c.FingerprintSecretAPIKey = "fp_secret"
	if err := c.ValidateProduction(); err != nil {
		t.Fatal(err)
	}
}
