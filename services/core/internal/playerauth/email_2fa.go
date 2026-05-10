package playerauth

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const playerEmailOTPTTL = 10 * time.Minute

// ErrEmailMFADeliveryUnavailable is returned when email 2FA is enabled but outbound mail is not configured.
var ErrEmailMFADeliveryUnavailable = errors.New("email_2fa_delivery_unavailable")

// ErrEmail2FAAdminLocked means operators blocked this account from using player-controlled email 2FA.
var ErrEmail2FAAdminLocked = errors.New("email_2fa_admin_locked")

// ErrEmail2FAAlreadyEnabled is returned when the player tries to begin enrollment while 2FA is already on.
var ErrEmail2FAAlreadyEnabled = errors.New("email_2fa_already_enabled")

// NeedPlayerEmailMFAError signals password login succeeded but an email OTP step is required before issuing JWTs.
type NeedPlayerEmailMFAError struct {
	MFAToken string
}

func (e *NeedPlayerEmailMFAError) Error() string { return "player_email_mfa_required" }

func randomOTP6() (string, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	n := binary.BigEndian.Uint32(b[:]) % 1000000
	return fmt.Sprintf("%06d", n), nil
}

func (s *Service) sendPlayerEmail2FACode(ctx context.Context, email, code, purposeLine string) error {
	if s.Mail == nil {
		return ErrEmailMFADeliveryUnavailable
	}
	em := strings.TrimSpace(strings.ToLower(email))
	subj := "Your sign-in verification code"
	body := fmt.Sprintf("%s\n\nYour verification code is: %s\n\nIt expires in 10 minutes. If you didn't request this, change your password immediately.\n",
		purposeLine, code)
	return s.Mail.Send(ctx, em, subj, body)
}

func (s *Service) insertEmailOTPChallenge(ctx context.Context, userID, purpose, codePlain, tokenPlain string) error {
	codeHash := hashRefresh(codePlain)
	tokHash := hashRefresh(tokenPlain)
	exp := time.Now().UTC().Add(playerEmailOTPTTL)
	_, err := s.Pool.Exec(ctx, `
		DELETE FROM player_email_otp_challenges WHERE user_id = $1::uuid AND purpose = $2
	`, userID, purpose)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO player_email_otp_challenges (token_hash, user_id, purpose, code_hash, expires_at)
		VALUES ($1, $2::uuid, $3, $4, $5)
	`, tokHash, userID, purpose, codeHash, exp)
	return err
}

// StartEmailMFALogin creates a login OTP challenge and emails the code.
func (s *Service) StartEmailMFALogin(ctx context.Context, userID, email string) (mfaTokenPlain string, err error) {
	if s.Mail == nil {
		return "", ErrEmailMFADeliveryUnavailable
	}
	code, err := randomOTP6()
	if err != nil {
		return "", err
	}
	plainTok, _, err := newRefreshToken()
	if err != nil {
		return "", err
	}
	if err := s.insertEmailOTPChallenge(ctx, userID, "login", code, plainTok); err != nil {
		return "", err
	}
	line := "Someone signed in to your account with your password."
	if err := s.sendPlayerEmail2FACode(ctx, email, code, line); err != nil {
		return "", err
	}
	return plainTok, nil
}

// VerifyEmailMFALogin checks the OTP and completes the session (JWT + refresh).
func (s *Service) VerifyEmailMFALogin(ctx context.Context, mfaTokenPlain, codePlain string, sc *SessionContext) (access, refresh string, exp int64, err error) {
	mfaTokenPlain = strings.TrimSpace(mfaTokenPlain)
	codePlain = strings.TrimSpace(strings.ReplaceAll(codePlain, " ", ""))
	if mfaTokenPlain == "" || len(codePlain) != 6 {
		return "", "", 0, ErrInvalidCredentials
	}
	th := hashRefresh(mfaTokenPlain)
	inputCodeHash := hashRefresh(codePlain)

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", "", 0, err
	}
	defer tx.Rollback(ctx)

	var uid string
	var attempts int16
	var expT time.Time
	var storedCodeHash string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, attempts_remaining, expires_at, code_hash
		FROM player_email_otp_challenges
		WHERE token_hash = $1 AND purpose = 'login'
		FOR UPDATE
	`, th).Scan(&uid, &attempts, &expT, &storedCodeHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", 0, ErrInvalidCredentials
		}
		return "", "", 0, err
	}
	if time.Now().UTC().After(expT) {
		_, _ = tx.Exec(ctx, `DELETE FROM player_email_otp_challenges WHERE token_hash = $1`, th)
		_ = tx.Commit(ctx)
		return "", "", 0, ErrInvalidCredentials
	}

	if inputCodeHash != storedCodeHash {
		attempts--
		if attempts <= 0 {
			_, _ = tx.Exec(ctx, `DELETE FROM player_email_otp_challenges WHERE token_hash = $1`, th)
		} else {
			_, _ = tx.Exec(ctx, `UPDATE player_email_otp_challenges SET attempts_remaining = $2 WHERE token_hash = $1`, th, attempts)
		}
		_ = tx.Commit(ctx)
		return "", "", 0, ErrInvalidCredentials
	}

	_, err = tx.Exec(ctx, `DELETE FROM player_email_otp_challenges WHERE token_hash = $1`, th)
	if err != nil {
		return "", "", 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", 0, err
	}

	if err := s.assertUserPlayAllowed(ctx, uid); err != nil {
		return "", "", 0, err
	}

	access, refresh, exp, err = s.issueSession(ctx, uid, sc)
	if err != nil {
		return "", "", 0, err
	}
	s.notifyBlueOceanLoginAsync(uid)
	return access, refresh, exp, nil
}

// StartEmail2FAEnable sends an OTP to confirm enabling email 2FA (authenticated user).
func (s *Service) StartEmail2FAEnable(ctx context.Context, userID, email string) (setupTokenPlain string, err error) {
	if s.Mail == nil {
		return "", ErrEmailMFADeliveryUnavailable
	}
	var locked, enabled bool
	err = s.Pool.QueryRow(ctx, `
		SELECT COALESCE(email_2fa_admin_locked, false), COALESCE(email_2fa_enabled, false)
		FROM users WHERE id = $1::uuid`, userID).Scan(&locked, &enabled)
	if err != nil {
		return "", err
	}
	if locked {
		return "", ErrEmail2FAAdminLocked
	}
	if enabled {
		return "", ErrEmail2FAAlreadyEnabled
	}
	code, err := randomOTP6()
	if err != nil {
		return "", err
	}
	plainTok, _, err := newRefreshToken()
	if err != nil {
		return "", err
	}
	if err := s.insertEmailOTPChallenge(ctx, userID, "enable", code, plainTok); err != nil {
		return "", err
	}
	line := "Enable email verification at sign-in on your account."
	if err := s.sendPlayerEmail2FACode(ctx, email, code, line); err != nil {
		return "", err
	}
	return plainTok, nil
}

// ConfirmEmail2FAEnable turns on email 2FA after OTP verification.
func (s *Service) ConfirmEmail2FAEnable(ctx context.Context, userID, setupTokenPlain, codePlain string) error {
	setupTokenPlain = strings.TrimSpace(setupTokenPlain)
	codePlain = strings.TrimSpace(strings.ReplaceAll(codePlain, " ", ""))
	if setupTokenPlain == "" || len(codePlain) != 6 {
		return ErrInvalidCredentials
	}
	th := hashRefresh(setupTokenPlain)
	inputCodeHash := hashRefresh(codePlain)

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var rowUID string
	var attempts int16
	var expT time.Time
	var storedCodeHash string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, attempts_remaining, expires_at, code_hash
		FROM player_email_otp_challenges
		WHERE token_hash = $1 AND purpose = 'enable'
		FOR UPDATE
	`, th).Scan(&rowUID, &attempts, &expT, &storedCodeHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidCredentials
		}
		return err
	}
	if rowUID != userID {
		return ErrInvalidCredentials
	}
	if time.Now().UTC().After(expT) {
		_, _ = tx.Exec(ctx, `DELETE FROM player_email_otp_challenges WHERE token_hash = $1`, th)
		_ = tx.Commit(ctx)
		return ErrInvalidCredentials
	}
	if inputCodeHash != storedCodeHash {
		attempts--
		if attempts <= 0 {
			_, _ = tx.Exec(ctx, `DELETE FROM player_email_otp_challenges WHERE token_hash = $1`, th)
		} else {
			_, _ = tx.Exec(ctx, `UPDATE player_email_otp_challenges SET attempts_remaining = $2 WHERE token_hash = $1`, th, attempts)
		}
		_ = tx.Commit(ctx)
		return ErrInvalidCredentials
	}
	_, err = tx.Exec(ctx, `DELETE FROM player_email_otp_challenges WHERE token_hash = $1`, th)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE users SET email_2fa_enabled = true
		WHERE id = $1::uuid AND COALESCE(email_2fa_admin_locked, false) = false
	`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrEmail2FAAdminLocked
	}
	return tx.Commit(ctx)
}

// DisableEmail2FA turns off player-controlled email 2FA when not admin-locked.
func (s *Service) DisableEmail2FA(ctx context.Context, userID string) error {
	var locked bool
	err := s.Pool.QueryRow(ctx, `
		SELECT COALESCE(email_2fa_admin_locked, false)
		FROM users WHERE id = $1::uuid
	`, userID).Scan(&locked)
	if err != nil {
		return err
	}
	if locked {
		return ErrEmail2FAAdminLocked
	}
	_, err = s.Pool.Exec(ctx, `UPDATE users SET email_2fa_enabled = false WHERE id = $1::uuid`, userID)
	return err
}
