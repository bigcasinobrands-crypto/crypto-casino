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

	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/crypto-casino/core/internal/passhash"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const refreshTTL = 7 * 24 * time.Hour

var ErrInvalidCredentials = errors.New("invalid credentials")

type Service struct {
	Pool   *pgxpool.Pool
	Issuer *jwtissuer.Issuer
	JTI    *jtiredis.Revoker
	Redis  *redis.Client // required when MFA WebAuthn is enforced for a staff user
}

func (s *Service) Login(ctx context.Context, email, password, requestIP string) (accessToken, refreshToken string, expiresAtUnix int64, err error) {
	if s.Issuer == nil {
		return "", "", 0, fmt.Errorf("jwt issuer not configured")
	}
	email = strings.ToLower(strings.TrimSpace(email))
	var id, hash, role string
	var mfaEnforced bool
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, password_hash, role, COALESCE(mfa_webauthn_enforced, false)
		FROM staff_users WHERE lower(email) = lower($1)
	`, email).Scan(&id, &hash, &role, &mfaEnforced)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	ok, rehash, err := passhash.Verify(password, hash)
	if err != nil || !ok {
		return "", "", 0, ErrInvalidCredentials
	}
	if rehash {
		newH, err := passhash.Hash(password)
		if err == nil {
			_, _ = s.Pool.Exec(ctx, `UPDATE staff_users SET password_hash = $1 WHERE id = $2::uuid`, newH, id)
		}
	}

	if mfaEnforced {
		var n int
		_ = s.Pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM staff_webauthn_credentials WHERE staff_user_id = $1::uuid
		`, id).Scan(&n)
		if n == 0 {
			return "", "", 0, ErrMFAEnforcedNoCredential
		}
		if s.Redis == nil {
			return "", "", 0, fmt.Errorf("redis required for MFA WebAuthn")
		}
		mfaTok, err := putMFAPending(ctx, s.Redis, id, role)
		if err != nil {
			return "", "", 0, err
		}
		return "", "", 0, &NeedMFAError{MFAToken: mfaTok}
	}

	return s.issueStaffSession(ctx, id, role, requestIP)
}

// issueStaffSession creates a refresh session and staff access JWT after successful auth (password or MFA).
func (s *Service) issueStaffSession(ctx context.Context, staffID, role, requestIP string) (accessToken, refreshPlain string, expiresAtUnix int64, err error) {
	plain, hashHex, err := newRefreshToken()
	if err != nil {
		return "", "", 0, err
	}
	exp := time.Now().UTC().Add(refreshTTL)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO staff_sessions (staff_user_id, refresh_token_hash, expires_at, family_id)
		VALUES ($1::uuid, $2, $3, gen_random_uuid())
	`, staffID, hashHex, exp)
	if err != nil {
		return "", "", 0, fmt.Errorf("session: %w", err)
	}
	accessToken, _, expUnix, err := s.Issuer.SignStaff(staffID, role)
	if err != nil {
		return "", "", 0, err
	}
	meta, _ := json.Marshal(map[string]string{"ip": requestIP})
	_, _ = s.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'staff.login', 'session', $2)
	`, staffID, meta)
	return accessToken, plain, expUnix, nil
}

func (s *Service) Refresh(ctx context.Context, refreshPlain string) (accessToken, refreshToken string, accessExpiresUnix int64, err error) {
	if s.Issuer == nil {
		return "", "", 0, fmt.Errorf("jwt issuer not configured")
	}
	refreshPlain = strings.TrimSpace(refreshPlain)
	if refreshPlain == "" {
		return "", "", 0, ErrInvalidCredentials
	}
	hashHex := hashRefresh(refreshPlain)
	var sid, staffID, fam string
	var exp time.Time
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, staff_user_id::text, expires_at, family_id::text FROM staff_sessions
		WHERE refresh_token_hash = $1
	`, hashHex).Scan(&sid, &staffID, &exp, &fam)
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
		INSERT INTO staff_sessions (staff_user_id, refresh_token_hash, expires_at, family_id)
		VALUES ($1::uuid, $2, $3, $4::uuid)
	`, staffID, newHashHex, newExp, fam)
	if err != nil {
		return "", "", 0, err
	}
	accessToken, _, expUnix, err := s.Issuer.SignStaff(staffID, role)
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

// RevokeAccessJTI invalidates the current access token (best-effort).
func (s *Service) RevokeAccessJTI(ctx context.Context, authHeader string) {
	if s == nil || s.Issuer == nil || s.JTI == nil || s.JTI.Rdb == nil {
		return
	}
	const p = "bearer "
	if len(authHeader) < len(p) || strings.ToLower(authHeader[:len(p)]) != p {
		return
	}
	raw := strings.TrimSpace(authHeader[len(p):])
	if raw == "" {
		return
	}
	_, _, jti, err := s.Issuer.ParseStaff(raw)
	if err != nil || jti == "" {
		return
	}
	_ = s.JTI.Revoke(ctx, jti, 30*time.Minute)
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

const redisKeyStaffMFA = "staff_mfa:"
const mfaPendingTTL = 5 * time.Minute

type mfaPending struct {
	StaffID string `json:"staff_id"`
	Role    string `json:"role"`
}

func putMFAPending(ctx context.Context, rdb *redis.Client, staffID, role string) (token string, err error) {
	var b [18]byte
	if _, err = rand.Read(b[:]); err != nil {
		return "", err
	}
	token = hex.EncodeToString(b[:])
	raw, err := json.Marshal(mfaPending{StaffID: staffID, Role: role})
	if err != nil {
		return "", err
	}
	if err := rdb.Set(ctx, redisKeyStaffMFA+token, raw, mfaPendingTTL).Err(); err != nil {
		return "", err
	}
	return token, nil
}
