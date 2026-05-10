package emailpolicy

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const SettingKey = "email.transactional"

const (
	DefaultVerificationSubject = "Verify your email"
	DefaultPasswordResetSubject = "Reset your password"
)

// TransactionalSpec controls transactional outbound templates from player-auth flows.
// Persisted as JSON under site_settings key SettingKey.
type TransactionalSpec struct {
	Verification struct {
		Enabled bool   `json:"enabled"`
		Subject string `json:"subject,omitempty"`
	} `json:"verification"`
	PasswordReset struct {
		Enabled bool   `json:"enabled"`
		Subject string `json:"subject,omitempty"`
	} `json:"password_reset"`
}

func DefaultTransactional() TransactionalSpec {
	var s TransactionalSpec
	s.Verification.Enabled = true
	s.PasswordReset.Enabled = true
	return s
}

// Normalize applies defaults after unmarshalling partial payloads from admins.
func Normalize(in TransactionalSpec) TransactionalSpec {
	out := DefaultTransactional()
	out.Verification.Enabled = in.Verification.Enabled
	out.Verification.Subject = strings.TrimSpace(in.Verification.Subject)
	out.PasswordReset.Enabled = in.PasswordReset.Enabled
	out.PasswordReset.Subject = strings.TrimSpace(in.PasswordReset.Subject)
	return out
}

func VerificationSubject(s TransactionalSpec) string {
	if t := strings.TrimSpace(s.Verification.Subject); t != "" {
		return t
	}
	return DefaultVerificationSubject
}

func PasswordResetSubject(s TransactionalSpec) string {
	if t := strings.TrimSpace(s.PasswordReset.Subject); t != "" {
		return t
	}
	return DefaultPasswordResetSubject
}

// LoadTransactional reads policy from site_settings; missing row yields defaults.
func LoadTransactional(ctx context.Context, pool *pgxpool.Pool) (TransactionalSpec, error) {
	if pool == nil {
		return DefaultTransactional(), nil
	}
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, SettingKey).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DefaultTransactional(), nil
		}
		return DefaultTransactional(), err
	}
	var s TransactionalSpec
	if err := json.Unmarshal(raw, &s); err != nil {
		return DefaultTransactional(), nil
	}
	return Normalize(s), nil
}
