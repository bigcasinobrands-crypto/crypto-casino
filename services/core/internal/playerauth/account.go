package playerauth

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const verifyTokenTTL = 24 * time.Hour
const resetTokenTTL = 1 * time.Hour


// MeProfile is returned by GET /v1/auth/me.
type MeProfile struct {
	ID              string
	Email           string
	CreatedAt       time.Time
	EmailVerifiedAt *time.Time
	Username        *string
	AvatarURL       *string
}

func (s *Service) MeProfile(ctx context.Context, userID string) (MeProfile, error) {
	var p MeProfile
	var ev *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, email, created_at, email_verified_at, username, avatar_url
		FROM users WHERE id = $1::uuid
	`, userID).Scan(&p.ID, &p.Email, &p.CreatedAt, &ev, &p.Username, &p.AvatarURL)
	p.EmailVerifiedAt = ev
	return p, err
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
	f, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, file); err != nil {
		return "", err
	}
	url := "/v1/avatars/" + userID + ext
	_, err = s.Pool.Exec(ctx, `UPDATE users SET avatar_url = $1 WHERE id = $2::uuid`, url, userID)
	return url, err
}

// ChangePassword validates the current password and sets a new one.
func (s *Service) ChangePassword(ctx context.Context, userID, currentPw, newPw string) error {
	if err := ValidatePassword(newPw); err != nil {
		return err
	}
	var phash string
	err := s.Pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1::uuid`, userID).Scan(&phash)
	if err != nil {
		return ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(phash), []byte(currentPw)) != nil {
		return ErrInvalidCredentials
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2::uuid`, string(newHash), userID)
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
	subject := "Verify your email"
	body := fmt.Sprintf("Open this link to verify your email (expires in 24h):\n\n%s\n", link)
	return s.Mail.Send(ctx, email, subject, body)
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
	var uid string
	err := s.Pool.QueryRow(ctx, `SELECT id::text FROM users WHERE lower(email) = lower($1)`, email).Scan(&uid)
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
	subject := "Reset your password"
	body := fmt.Sprintf("Open this link to reset your password (expires in 1 hour):\n\n%s\n", link)
	return s.Mail.Send(ctx, email, subject, body)
}

func (s *Service) ResetPassword(ctx context.Context, plainToken, newPassword string) error {
	if err := ValidatePassword(newPassword); err != nil {
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
	hashBytes, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	hash := string(hashBytes)
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
