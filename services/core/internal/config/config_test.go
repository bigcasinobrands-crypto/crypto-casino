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

func TestLoad_requireFingerprintPlayerAuth_defaultsByAppEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("PLAYER_JWT_SECRET", "")
	t.Setenv("REQUIRE_FINGERPRINT_PLAYER_AUTH", "")

	t.Run("development_unset_requires_false", func(t *testing.T) {
		t.Setenv("APP_ENV", "development")
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if c.RequireFingerprintPlayerAuth {
			t.Fatal("expected RequireFingerprintPlayerAuth false when APP_ENV=development and env unset (local dev without VITE FP)")
		}
	})

	t.Run("production_unset_requires_true", func(t *testing.T) {
		t.Setenv("APP_ENV", "production")
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if !c.RequireFingerprintPlayerAuth {
			t.Fatal("expected RequireFingerprintPlayerAuth true when APP_ENV=production and env unset")
		}
	})

	t.Run("production_explicit_false", func(t *testing.T) {
		t.Setenv("APP_ENV", "production")
		t.Setenv("REQUIRE_FINGERPRINT_PLAYER_AUTH", "false")
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if c.RequireFingerprintPlayerAuth {
			t.Fatal("expected RequireFingerprintPlayerAuth false when explicitly false")
		}
	})
}

func TestLoad_blueOceanUserIDNoHyphens(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("PLAYER_JWT_SECRET", "")

	t.Run("empty_env_defaults_true", func(t *testing.T) {
		t.Setenv("BLUEOCEAN_USERID_NO_HYPHENS", "")
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if !c.BlueOceanUserIDNoHyphens {
			t.Fatal("expected BlueOceanUserIDNoHyphens true when env empty/unset (default compact UUIDs for XAPI)")
		}
	})

	t.Run("explicit_false", func(t *testing.T) {
		t.Setenv("BLUEOCEAN_USERID_NO_HYPHENS", "false")
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if c.BlueOceanUserIDNoHyphens {
			t.Fatal("expected BlueOceanUserIDNoHyphens false")
		}
	})

	t.Run("explicit_true", func(t *testing.T) {
		t.Setenv("BLUEOCEAN_USERID_NO_HYPHENS", "true")
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if !c.BlueOceanUserIDNoHyphens {
			t.Fatal("expected BlueOceanUserIDNoHyphens true")
		}
	})
}

func TestValidateProduction_passimpayRequiresCredentials(t *testing.T) {
	base := &Config{
		AppEnv:        "production",
		JWTSecret:     strings.Repeat("y", 32),
		RedisURL:      "redis://localhost:6379",
		JWTRSAKeyFile: "/path/to/key.pem",
		PaymentProvider: "passimpay",
		// PassimPay not configured
		PassimpayPlatformID: 0,
		PassimpaySecretKey:  "",
		PassimpayAPIBaseURL: "https://api.passimpay.io",
	}
	if err := base.ValidateProduction(); err == nil {
		t.Fatal("expected error when passimpay selected but not configured")
	}
	base.PassimpayPlatformID = 1
	base.PassimpaySecretKey = "secret"
	if err := base.ValidateProduction(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateProduction_paymentProviderNoneSkipsPassimpay(t *testing.T) {
	c := &Config{
		AppEnv:            "production",
		JWTSecret:         strings.Repeat("y", 32),
		RedisURL:          "redis://localhost:6379",
		JWTRSAKeyFile:     "/path/to/key.pem",
		PaymentProvider:   "none",
		PassimpayPlatformID: 0,
		PassimpaySecretKey:  "",
		PassimpayAPIBaseURL: "https://api.passimpay.io",
	}
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
