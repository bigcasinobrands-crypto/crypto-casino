package playerauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/jwtplayer"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const refreshTTL = 7 * 24 * time.Hour

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrTermsNotAccepted = errors.New("terms not accepted")

type Service struct {
	Pool            *pgxpool.Pool
	Secret          []byte
	Mail            mail.Sender
	PublicPlayerURL string
	TermsVersion    string
	PrivacyVersion  string
}

func (s *Service) Register(ctx context.Context, email, password string, acceptTerms, acceptPrivacy bool) (accessToken, refreshToken string, exp int64, err error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return "", "", 0, ErrInvalidCredentials
	}
	if !acceptTerms || !acceptPrivacy {
		return "", "", 0, ErrTermsNotAccepted
	}
	if err := ValidatePassword(password); err != nil {
		return "", "", 0, err
	}
	var taken bool
	_ = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE lower(email) = lower($1))`, email).Scan(&taken)
	if taken {
		return "", "", 0, ErrInvalidCredentials
	}
	tv, pv := s.TermsVersion, s.PrivacyVersion
	if tv == "" {
		tv = "1"
	}
	if pv == "" {
		pv = "1"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", "", 0, err
	}
	var id string
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1, $2, now(), $3, $4) RETURNING id::text
	`, email, string(hash), tv, pv).Scan(&id)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	accessToken, refreshToken, exp, err = s.issueSession(ctx, id)
	if err != nil {
		return "", "", 0, err
	}
	if s.Mail != nil {
		go func(uid, em string) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			_ = s.sendVerificationEmail(ctx, uid, em)
		}(id, email)
	}
	return accessToken, refreshToken, exp, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (accessToken, refreshToken string, exp int64, err error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var id, phash string
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, password_hash FROM users WHERE lower(email) = lower($1)
	`, email).Scan(&id, &phash)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(phash), []byte(password)) != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	return s.issueSession(ctx, id)
}

func (s *Service) issueSession(ctx context.Context, userID string) (access, refresh string, exp int64, err error) {
	plain, hashHex, err := newRefreshToken()
	if err != nil {
		return "", "", 0, err
	}
	expT := time.Now().UTC().Add(refreshTTL)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO player_sessions (user_id, refresh_token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, userID, hashHex, expT)
	if err != nil {
		return "", "", 0, fmt.Errorf("session: %w", err)
	}
	access, exp, err = jwtplayer.SignAccess(s.Secret, userID)
	if err != nil {
		return "", "", 0, err
	}
	return access, plain, exp, nil
}

func (s *Service) Refresh(ctx context.Context, refreshPlain string) (access, refresh string, exp int64, err error) {
	refreshPlain = strings.TrimSpace(refreshPlain)
	if refreshPlain == "" {
		return "", "", 0, ErrInvalidCredentials
	}
	h := hashRefresh(refreshPlain)
	var sid, uid string
	var ex time.Time
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, expires_at FROM player_sessions WHERE refresh_token_hash = $1
	`, h).Scan(&sid, &uid, &ex)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	if time.Now().UTC().After(ex) {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM player_sessions WHERE id = $1::uuid`, sid)
		return "", "", 0, ErrInvalidCredentials
	}
	_, _ = s.Pool.Exec(ctx, `DELETE FROM player_sessions WHERE id = $1::uuid`, sid)
	plain, nh, err := newRefreshToken()
	if err != nil {
		return "", "", 0, err
	}
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO player_sessions (user_id, refresh_token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, uid, nh, time.Now().UTC().Add(refreshTTL))
	if err != nil {
		return "", "", 0, err
	}
	access, exp, err = jwtplayer.SignAccess(s.Secret, uid)
	return access, plain, exp, err
}

func (s *Service) Logout(ctx context.Context, refreshPlain string) error {
	refreshPlain = strings.TrimSpace(refreshPlain)
	if refreshPlain == "" {
		return ErrInvalidCredentials
	}
	tag, err := s.Pool.Exec(ctx, `DELETE FROM player_sessions WHERE refresh_token_hash = $1`, hashRefresh(refreshPlain))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidCredentials
	}
	return nil
}


func newRefreshToken() (plain string, hashHex string, err error) {
	var b [32]byte
	if _, err = rand.Read(b[:]); err != nil {
		return "", "", err
	}
	plain = base64.RawURLEncoding.EncodeToString(b[:])
	return plain, hashRefresh(plain), nil
}

func hashRefresh(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}
