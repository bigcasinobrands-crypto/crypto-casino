package staffauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/jwtstaff"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const refreshTTL = 7 * 24 * time.Hour

var ErrInvalidCredentials = errors.New("invalid credentials")

type Service struct {
	Pool   *pgxpool.Pool
	Secret []byte
}

func (s *Service) Login(ctx context.Context, email, password, requestIP string) (accessToken, refreshToken string, expiresAtUnix int64, err error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var id, hash, role string
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, password_hash, role FROM staff_users WHERE lower(email) = lower($1)
	`, email).Scan(&id, &hash, &role)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	plain, hashHex, err := newRefreshToken()
	if err != nil {
		return "", "", 0, err
	}
	exp := time.Now().UTC().Add(refreshTTL)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO staff_sessions (staff_user_id, refresh_token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, id, hashHex, exp)
	if err != nil {
		return "", "", 0, fmt.Errorf("session: %w", err)
	}
	accessToken, expUnix, err := jwtstaff.SignAccess(s.Secret, id, role)
	if err != nil {
		return "", "", 0, err
	}
	meta, _ := json.Marshal(map[string]string{"ip": requestIP})
	_, _ = s.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'staff.login', 'session', $2)
	`, id, meta)
	return accessToken, plain, expUnix, nil
}

func (s *Service) Refresh(ctx context.Context, refreshPlain string) (accessToken, refreshToken string, accessExpiresUnix int64, err error) {
	refreshPlain = strings.TrimSpace(refreshPlain)
	if refreshPlain == "" {
		return "", "", 0, ErrInvalidCredentials
	}
	hashHex := hashRefresh(refreshPlain)
	var sid, staffID string
	var exp time.Time
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, staff_user_id::text, expires_at FROM staff_sessions
		WHERE refresh_token_hash = $1
	`, hashHex).Scan(&sid, &staffID, &exp)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	if time.Now().UTC().After(exp) {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM staff_sessions WHERE id = $1::uuid`, sid)
		return "", "", 0, ErrInvalidCredentials
	}
	_, err = s.Pool.Exec(ctx, `DELETE FROM staff_sessions WHERE id = $1::uuid`, sid)
	if err != nil {
		return "", "", 0, err
	}
	var role string
	err = s.Pool.QueryRow(ctx, `SELECT role FROM staff_users WHERE id = $1::uuid`, staffID).Scan(&role)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	plain, newHashHex, err := newRefreshToken()
	if err != nil {
		return "", "", 0, err
	}
	newExp := time.Now().UTC().Add(refreshTTL)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO staff_sessions (staff_user_id, refresh_token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, staffID, newHashHex, newExp)
	if err != nil {
		return "", "", 0, err
	}
	accessToken, expUnix, err := jwtstaff.SignAccess(s.Secret, staffID, role)
	if err != nil {
		return "", "", 0, err
	}
	return accessToken, plain, expUnix, nil
}

func (s *Service) Logout(ctx context.Context, refreshPlain string) error {
	refreshPlain = strings.TrimSpace(refreshPlain)
	if refreshPlain == "" {
		return ErrInvalidCredentials
	}
	hashHex := hashRefresh(refreshPlain)
	tag, err := s.Pool.Exec(ctx, `DELETE FROM staff_sessions WHERE refresh_token_hash = $1`, hashHex)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidCredentials
	}
	return nil
}

func (s *Service) Me(ctx context.Context, staffID string) (email, role string, err error) {
	err = s.Pool.QueryRow(ctx, `
		SELECT email, role FROM staff_users WHERE id = $1::uuid
	`, staffID).Scan(&email, &role)
	return email, role, err
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
