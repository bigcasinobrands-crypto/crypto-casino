package playerauth

import (
	"context"
	"fmt"
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
}

func (s *Service) MeProfile(ctx context.Context, userID string) (MeProfile, error) {
	var p MeProfile
	var ev *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, email, created_at, email_verified_at
		FROM users WHERE id = $1::uuid
	`, userID).Scan(&p.ID, &p.Email, &p.CreatedAt, &ev)
	p.EmailVerifiedAt = ev
	return p, err
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
