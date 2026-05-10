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

// TransactionalSpec controls outbound mail from auth, wallet webhooks, and compliance tooling.
// Persisted as JSON under site_settings key SettingKey.
type TransactionalSpec struct {
	Verification struct {
		// Enabled uses a pointer so omitted JSON keys stay “unset” and Normalize keeps auth-email defaults on.
		Enabled *bool  `json:"enabled,omitempty"`
		Subject string `json:"subject,omitempty"`
	} `json:"verification"`
	PasswordReset struct {
		Enabled *bool  `json:"enabled,omitempty"`
		Subject string `json:"subject,omitempty"`
	} `json:"password_reset"`
	// WalletNotifications — optional receipts for PassimPay rails (all default off).
	WalletNotifications struct {
		WithdrawalSubmitted       bool `json:"withdrawal_submitted"`
		WithdrawalCompleted       bool `json:"withdrawal_completed"`
		WithdrawalRejected        bool `json:"withdrawal_rejected"`
		WithdrawalProviderFailed  bool `json:"withdrawal_provider_failed"`
		DepositCredited           bool `json:"deposit_credited"`
	} `json:"wallet_notifications"`
	// ComplianceNotifications — player notices when staff applies RG / closure (default off).
	ComplianceNotifications struct {
		AccountRestricted bool `json:"account_restricted"`
	} `json:"compliance_notifications"`
}

func DefaultTransactional() TransactionalSpec {
	var s TransactionalSpec
	ev, pv := true, true
	s.Verification.Enabled = &ev
	s.PasswordReset.Enabled = &pv
	return s
}

// VerificationEnabled returns whether outbound verification mail is allowed (default true).
func VerificationEnabled(s TransactionalSpec) bool {
	if s.Verification.Enabled == nil {
		return true
	}
	return *s.Verification.Enabled
}

// PasswordResetEnabled returns whether forgot-password mail is allowed (default true).
func PasswordResetEnabled(s TransactionalSpec) bool {
	if s.PasswordReset.Enabled == nil {
		return true
	}
	return *s.PasswordReset.Enabled
}

// Normalize applies defaults after unmarshalling partial payloads from admins.
func Normalize(in TransactionalSpec) TransactionalSpec {
	out := DefaultTransactional()
	if in.Verification.Enabled != nil {
		v := *in.Verification.Enabled
		out.Verification.Enabled = &v
	}
	out.Verification.Subject = strings.TrimSpace(in.Verification.Subject)
	if in.PasswordReset.Enabled != nil {
		v := *in.PasswordReset.Enabled
		out.PasswordReset.Enabled = &v
	}
	out.PasswordReset.Subject = strings.TrimSpace(in.PasswordReset.Subject)
	out.WalletNotifications.WithdrawalSubmitted = in.WalletNotifications.WithdrawalSubmitted
	out.WalletNotifications.WithdrawalCompleted = in.WalletNotifications.WithdrawalCompleted
	out.WalletNotifications.WithdrawalRejected = in.WalletNotifications.WithdrawalRejected
	out.WalletNotifications.WithdrawalProviderFailed = in.WalletNotifications.WithdrawalProviderFailed
	out.WalletNotifications.DepositCredited = in.WalletNotifications.DepositCredited
	out.ComplianceNotifications.AccountRestricted = in.ComplianceNotifications.AccountRestricted
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
