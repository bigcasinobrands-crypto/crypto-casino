package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL       string
	Port              string
	JWTSecret         string
	PlayerJWTSecret   string
	AdminCORSOrigins  []string
	PlayerCORSOrigins []string
	RedisURL          string
	// Player auth baseline
	PublicPlayerURL string
	TurnstileSecret string
	SMTPHost        string
	SMTPPort        string
	SMTPUser        string
	SMTPPassword    string
	SMTPFrom        string
	TermsVersion    string
	PrivacyVersion  string
}

func Load() (Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load("../../.env")

	c := Config{
		DatabaseURL: strings.TrimSpace(os.Getenv("DATABASE_URL")),
		Port:        strings.TrimSpace(os.Getenv("PORT")),
		JWTSecret:   strings.TrimSpace(os.Getenv("JWT_SECRET")),
		RedisURL:    strings.TrimSpace(os.Getenv("REDIS_URL")),
	}
	if c.Port == "" {
		c.Port = "8080"
	}
	c.AdminCORSOrigins = parseOriginsList(os.Getenv("ADMIN_CORS_ORIGINS"), []string{"http://localhost:5173"})
	c.PlayerCORSOrigins = parseOriginsList(os.Getenv("PLAYER_CORS_ORIGINS"), []string{"http://localhost:5174"})
	c.PlayerJWTSecret = strings.TrimSpace(os.Getenv("PLAYER_JWT_SECRET"))
	if c.PlayerJWTSecret == "" {
		c.PlayerJWTSecret = c.JWTSecret
	}
	c.PublicPlayerURL = strings.TrimSpace(os.Getenv("PUBLIC_PLAYER_URL"))
	if c.PublicPlayerURL == "" {
		c.PublicPlayerURL = "http://localhost:5174"
	}
	c.TurnstileSecret = strings.TrimSpace(os.Getenv("TURNSTILE_SECRET"))
	c.SMTPHost = strings.TrimSpace(os.Getenv("SMTP_HOST"))
	c.SMTPPort = strings.TrimSpace(os.Getenv("SMTP_PORT"))
	c.SMTPUser = strings.TrimSpace(os.Getenv("SMTP_USER"))
	c.SMTPPassword = strings.TrimSpace(os.Getenv("SMTP_PASSWORD"))
	c.SMTPFrom = strings.TrimSpace(os.Getenv("SMTP_FROM"))
	c.TermsVersion = strings.TrimSpace(os.Getenv("TERMS_VERSION"))
	if c.TermsVersion == "" {
		c.TermsVersion = "1"
	}
	c.PrivacyVersion = strings.TrimSpace(os.Getenv("PRIVACY_VERSION"))
	if c.PrivacyVersion == "" {
		c.PrivacyVersion = "1"
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 {
		return c, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	if len(c.PlayerJWTSecret) < 32 {
		return c, fmt.Errorf("PLAYER_JWT_SECRET must be at least 32 characters when set; defaults to JWT_SECRET")
	}
	return c, nil
}

func parseOriginsList(raw string, defaultOrigins []string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		out := make([]string, len(defaultOrigins))
		copy(out, defaultOrigins)
		return out
	}
	var list []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			list = append(list, o)
		}
	}
	return list
}
