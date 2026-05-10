package playerauth

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/emailpolicy"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/passhash"
	"github.com/crypto-casino/core/internal/privacy"
	"github.com/crypto-casino/core/internal/safepath"
	"github.com/google/uuid"
)

const verifyTokenTTL = 24 * time.Hour
const resetTokenTTL = 1 * time.Hour

// MeProfile is returned by GET /v1/auth/me.
type MeProfile struct {
	ID                  string
	PublicParticipantID string
	Email               string
	CreatedAt           time.Time
	EmailVerifiedAt     *time.Time
	Username            *string
	AvatarURL           *string
	VIPTierID           *int
	VIPTierName         *string
	Email2FAEnabled     bool
	Email2FAAdminLocked bool
	KYCStatus           string
	KYCRejectReason     *string
	KYCRequiredReason   *string
}

func (s *Service) MeProfile(ctx context.Context, userID string) (MeProfile, error) {
	var p MeProfile
	var ev *time.Time
	var rawAvatar *string
	err := s.Pool.QueryRow(ctx, `
		SELECT u.id::text, u.public_participant_id::text, u.email, u.created_at, u.email_verified_at, u.username, u.avatar_url,
			COALESCE(u.email_2fa_enabled, false), COALESCE(u.email_2fa_admin_locked, false),
			COALESCE(NULLIF(trim(u.kyc_status), ''), 'none'), u.kyc_reject_reason, u.kyc_required_reason,
			pvs.tier_id, vt.name
		FROM users u
		LEFT JOIN player_vip_state pvs ON pvs.user_id = u.id
		LEFT JOIN vip_tiers vt ON vt.id = pvs.tier_id
		WHERE u.id = $1::uuid
	`, userID).Scan(&p.ID, &p.PublicParticipantID, &p.Email, &p.CreatedAt, &ev, &p.Username, &rawAvatar,
		&p.Email2FAEnabled, &p.Email2FAAdminLocked, &p.KYCStatus, &p.KYCRejectReason, &p.KYCRequiredReason, &p.VIPTierID, &p.VIPTierName)
	p.EmailVerifiedAt = ev
	if err != nil {
		return p, err
	}
	if rawAvatar != nil && *rawAvatar != "" {
		visible := privacy.PlayerVisibleAvatarURL(*rawAvatar, p.PublicParticipantID)
		if visible != "" {
			p.AvatarURL = &visible
		}
	}
	return p, nil
}

var ErrUsernameTaken = fmt.Errorf("username taken")
var ErrInvalidUsername = fmt.Errorf("invalid username")

func validateUsername(u string) error {
	if len(u) < 3 || len(u) > 20 {
		return ErrInvalidUsername
	}
	for _, c := range u {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return ErrInvalidUsername
		}
	}
	return nil
}

func (s *Service) UpdateUsername(ctx context.Context, userID, username string) error {
	if username == "" {
		_, err := s.Pool.Exec(ctx, `UPDATE users SET username = NULL WHERE id = $1::uuid`, userID)
		return err
	}
	if err := validateUsername(username); err != nil {
		return err
	}
	var taken bool
	_ = s.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM users WHERE lower(username) = lower($1) AND id != $2::uuid)
	`, username, userID).Scan(&taken)
	if taken {
		return ErrUsernameTaken
	}
	_, err := s.Pool.Exec(ctx, `UPDATE users SET username = $1 WHERE id = $2::uuid`, username, userID)
	return err
}

func (s *Service) SaveAvatar(ctx context.Context, userID string, file io.Reader, filename string) (string, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return "", fmt.Errorf("invalid user")
	}
	ext := ".png"
	if idx := strings.LastIndex(filename, "."); idx >= 0 {
		ext = strings.ToLower(filename[idx:])
	}
	allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}
	if !allowed[ext] {
		ext = ".png"
	}
	dir := filepath.Join(s.DataDir, "avatars")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dest := filepath.Join(dir, userID+ext)
	if !safepath.Within(dir, dest) {
		return "", fmt.Errorf("invalid path")
	}
	f, err := os.Create(dest) // #nosec G703 -- dest under safepath.Within(dir,*); userID is validated UUID
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, file); err != nil {
		return "", err
	}
	var pid string
	if err := s.Pool.QueryRow(ctx, `SELECT public_participant_id::text FROM users WHERE id = $1::uuid`, userID).Scan(&pid); err != nil {
		return "", err
	}
	url := "/v1/avatars/by-participant/" + pid + ext
	_, err = s.Pool.Exec(ctx, `UPDATE users SET avatar_url = $1 WHERE id = $2::uuid`, url, userID)
	return url, err
}

// ChangePassword validates the current password and sets a new one.
func (s *Service) ChangePassword(ctx context.Context, userID, currentPw, newPw string) error {
	if err := ValidatePassword(newPw); err != nil {
		return err
	}
	if err := s.rejectIfPwnedPassword(ctx, newPw); err != nil {
		return err
	}
	var phash string
	err := s.Pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1::uuid`, userID).Scan(&phash)
	if err != nil {
		return ErrInvalidCredentials
	}
	ok, _, err := passhash.Verify(currentPw, phash)
	if err != nil || !ok {
		return ErrInvalidCredentials
	}
	newHash, err := passhash.Hash(newPw)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2::uuid`, newHash, userID)
	return err
}

// GetPreferences returns the user's preferences JSON.
func (s *Service) GetPreferences(ctx context.Context, userID string) (map[string]any, error) {
	var prefs map[string]any
	err := s.Pool.QueryRow(ctx, `SELECT COALESCE(preferences, '{}') FROM users WHERE id = $1::uuid`, userID).Scan(&prefs)
	if err != nil {
		return map[string]any{}, err
	}
	if prefs == nil {
		prefs = map[string]any{}
	}
	return prefs, nil
}

// UpdatePreferences merges the given keys into the user's preferences JSON.
func (s *Service) UpdatePreferences(ctx context.Context, userID string, patch map[string]any) error {
	current, err := s.GetPreferences(ctx, userID)
	if err != nil {
		return err
	}
	for k, v := range patch {
		current[k] = v
	}
	_, err = s.Pool.Exec(ctx, `UPDATE users SET preferences = $1 WHERE id = $2::uuid`, current, userID)
	return err
}

// RedeemPromo records a promo code redemption. Returns ErrPromoAlreadyUsed if already redeemed.
var ErrPromoAlreadyUsed = fmt.Errorf("promo code already used")

func (s *Service) RedeemPromo(ctx context.Context, userID, code string) error {
	code = strings.TrimSpace(strings.ToUpper(code))
	if code == "" {
		return fmt.Errorf("empty promo code")
	}
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO promo_redemptions (user_id, code) VALUES ($1::uuid, $2)
	`, userID, code)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			return ErrPromoAlreadyUsed
		}
		return err
	}
	return nil
}

func (s *Service) sendVerificationEmail(ctx context.Context, userID, email string) error {
	if s.Mail == nil {
		return nil
	}
	pol, err := emailpolicy.LoadTransactional(ctx, s.Pool)
	if err != nil {
		return err
	}
	plain, hashHex, err := newRefreshToken()
	if err != nil {
		return err
	}
	exp := time.Now().UTC().Add(verifyTokenTTL)
	_, _ = s.Pool.Exec(ctx, `DELETE FROM email_verification_tokens WHERE user_id = $1::uuid`, userID)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, userID, hashHex, exp)
	if err != nil {
		return err
	}
	link := strings.TrimRight(s.PublicPlayerURL, "/") + "/verify-email?token=" + plain
	if !emailpolicy.VerificationEnabled(pol) {
		return nil
	}
	subject := emailpolicy.VerificationSubject(pol)

	brand := "VybeBet"
	if s.Cfg != nil && strings.TrimSpace(s.Cfg.MailBrandSiteName) != "" {
		brand = strings.TrimSpace(s.Cfg.MailBrandSiteName)
	}
	plainBody, htmlBody := mail.VerificationEmailBodies(brand, link)

	tid := ""
	if s.Cfg != nil {
		tid = strings.TrimSpace(s.Cfg.ResendTemplateVerifyEmail)
	}
	vars := map[string]string{
		mail.TemplateVarSiteName:        brand,
		mail.TemplateVarPreheader:       "Verify your email address",
		mail.TemplateVarPrimaryHeadline: "Confirm your email",
		mail.TemplateVarPrimaryBody:     "Use the secure link below to verify your email and finish setting up your account.",
		mail.TemplateVarActionURL:       link,
		mail.TemplateVarButtonLabel:     "Verify email",
		mail.TemplateVarExpiryLine:      "This link expires in 24 hours.",
		mail.TemplateVarSecondaryNote:   "If you didn't create an account, you can safely ignore this email.",
	}
	sent, err := mail.TryResendPublishedTemplate(s.Mail, ctx, email, subject, tid, vars)
	if err != nil {
		return err
	}
	if sent {
		return nil
	}
	return mail.SendTransactional(ctx, s.Mail, email, subject, plainBody, htmlBody)
}

// ResendVerificationEmail creates a new token and sends mail (authenticated user).
func (s *Service) ResendVerificationEmail(ctx context.Context, userID string) error {
	var email string
	var verified *time.Time
	err := s.Pool.QueryRow(ctx, `SELECT email, email_verified_at FROM users WHERE id = $1::uuid`, userID).Scan(&email, &verified)
	if err != nil {
		return err
	}
	if verified != nil {
		return nil
	}
	return s.sendVerificationEmail(ctx, userID, email)
}

// ConfirmVerificationToken marks email verified and deletes the token row.
func (s *Service) ConfirmVerificationToken(ctx context.Context, plain string) error {
	plain = strings.TrimSpace(plain)
	if plain == "" {
		return ErrInvalidCredentials
	}
	h := hashRefresh(plain)
	var uid string
	var exp time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT user_id::text, expires_at FROM email_verification_tokens WHERE token_hash = $1
	`, h).Scan(&uid, &exp)
	if err != nil {
		return ErrInvalidCredentials
	}
	if time.Now().UTC().After(exp) {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM email_verification_tokens WHERE token_hash = $1`, h)
		return ErrInvalidCredentials
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE users SET email_verified_at = now() WHERE id = $1::uuid`, uid)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM email_verification_tokens WHERE token_hash = $1`, h)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RequestPasswordReset always succeeds from caller's perspective; emails only if user exists.
func (s *Service) RequestPasswordReset(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || s.Mail == nil {
		return nil
	}
	pol, err := emailpolicy.LoadTransactional(ctx, s.Pool)
	if err != nil {
		return err
	}
	if !emailpolicy.PasswordResetEnabled(pol) {
		return nil
	}
	var uid string
	err = s.Pool.QueryRow(ctx, `SELECT id::text FROM users WHERE lower(email) = lower($1)`, email).Scan(&uid)
	if err != nil {
		return nil
	}
	plain, hashHex, err := newRefreshToken()
	if err != nil {
		return err
	}
	exp := time.Now().UTC().Add(resetTokenTTL)
	_, _ = s.Pool.Exec(ctx, `DELETE FROM password_reset_tokens WHERE user_id = $1::uuid`, uid)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, uid, hashHex, exp)
	if err != nil {
		return err
	}
	link := strings.TrimRight(s.PublicPlayerURL, "/") + "/reset-password?token=" + plain
	subject := emailpolicy.PasswordResetSubject(pol)
	body := fmt.Sprintf("Open this link to reset your password (expires in 1 hour):\n\n%s\n", link)

	tid := ""
	if s.Cfg != nil {
		tid = strings.TrimSpace(s.Cfg.ResendTemplatePasswordReset)
	}
	brand := "VybeBet"
	if s.Cfg != nil && strings.TrimSpace(s.Cfg.MailBrandSiteName) != "" {
		brand = strings.TrimSpace(s.Cfg.MailBrandSiteName)
	}
	vars := map[string]string{
		mail.TemplateVarSiteName:        brand,
		mail.TemplateVarPreheader:       "Password reset requested",
		mail.TemplateVarPrimaryHeadline: "Reset your password",
		mail.TemplateVarPrimaryBody:     "We received a request to reset your password. Use the secure link below to choose a new password.",
		mail.TemplateVarActionURL:       link,
		mail.TemplateVarButtonLabel:     "Reset password",
		mail.TemplateVarExpiryLine:      "This link expires in 1 hour.",
		mail.TemplateVarSecondaryNote:   "If you didn't request this, you can ignore this email — your password will stay the same.",
	}
	sent, err := mail.TryResendPublishedTemplate(s.Mail, ctx, email, subject, tid, vars)
	if err != nil {
		return err
	}
	if sent {
		return nil
	}
	return s.Mail.Send(ctx, email, subject, body)
}

func (s *Service) ResetPassword(ctx context.Context, plainToken, newPassword string) error {
	if err := ValidatePassword(newPassword); err != nil {
		return err
	}
	if err := s.rejectIfPwnedPassword(ctx, newPassword); err != nil {
		return err
	}
	plainToken = strings.TrimSpace(plainToken)
	if plainToken == "" {
		return ErrInvalidCredentials
	}
	h := hashRefresh(plainToken)
	var uid string
	var exp time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT user_id::text, expires_at FROM password_reset_tokens WHERE token_hash = $1
	`, h).Scan(&uid, &exp)
	if err != nil {
		return ErrInvalidCredentials
	}
	if time.Now().UTC().After(exp) {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM password_reset_tokens WHERE token_hash = $1`, h)
		return ErrInvalidCredentials
	}
	hash, err := passhash.Hash(newPassword)
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2::uuid`, hash, uid)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM password_reset_tokens WHERE user_id = $1::uuid`, uid)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM player_sessions WHERE user_id = $1::uuid`, uid)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
