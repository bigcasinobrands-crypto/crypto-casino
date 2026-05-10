package kycaid

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SiteSettingKYCAID is the site_settings JSON key for KYCAID form / UX options.
const SiteSettingKYCAID = "kycaid.settings"

// Settings is persisted under SiteSettingKYCAID (merged with defaults server-side).
type Settings struct {
	TestMode bool `json:"test_mode"`
	// FormID — KYCAID hosted form id from dashboard (required for player form URLs).
	FormID string `json:"form_id"`
	// RedirectPathAfterForm — path or absolute URL fragment appended after PublicPlayerURL for redirect_url.
	RedirectPathAfterForm string `json:"redirect_path_after_form"`
}

func defaultSettings() Settings {
	return Settings{
		TestMode:              false,
		FormID:                "",
		RedirectPathAfterForm: "/profile?settings=verify",
	}
}

// LoadSettings reads merged KYCAID UI/settings from site_settings.
func LoadSettings(ctx context.Context, pool *pgxpool.Pool) Settings {
	s := defaultSettings()
	if pool == nil {
		return s
	}
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, SiteSettingKYCAID).Scan(&raw)
	if err != nil || len(raw) == 0 {
		return s
	}
	var patch Settings
	if json.Unmarshal(raw, &patch) != nil {
		return s
	}
	if patch.FormID != "" {
		s.FormID = strings.TrimSpace(patch.FormID)
	}
	if strings.TrimSpace(patch.RedirectPathAfterForm) != "" {
		s.RedirectPathAfterForm = strings.TrimSpace(patch.RedirectPathAfterForm)
	}
	s.TestMode = patch.TestMode
	return s
}
