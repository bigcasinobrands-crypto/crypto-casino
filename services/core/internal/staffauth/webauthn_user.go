package staffauth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type staffWebUser struct {
	id          uuid.UUID
	email       string
	credentials []webauthn.Credential
}

func (u *staffWebUser) WebAuthnID() []byte                         { return u.id[:] }
func (u *staffWebUser) WebAuthnName() string                     { return u.email }
func (u *staffWebUser) WebAuthnDisplayName() string              { return u.email }
func (u *staffWebUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func loadStaffWebUser(ctx context.Context, pool *pgxpool.Pool, staffID string) (*staffWebUser, error) {
	uid, err := uuid.Parse(staffID)
	if err != nil {
		return nil, err
	}
	var email string
	if err := pool.QueryRow(ctx, `SELECT email FROM staff_users WHERE id = $1::uuid`, staffID).Scan(&email); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT credential_json FROM staff_webauthn_credentials WHERE staff_user_id = $1::uuid ORDER BY created_at ASC
	`, staffID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var creds []webauthn.Credential
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		var c webauthn.Credential
		if err := json.Unmarshal(raw, &c); err != nil {
			continue
		}
		creds = append(creds, c)
	}
	return &staffWebUser{id: uid, email: email, credentials: creds}, rows.Err()
}

type regRedisPayload struct {
	StaffID string               `json:"staff_id"`
	Session webauthn.SessionData `json:"session"`
}

type mfaLoginRedisPayload struct {
	MFAToken string               `json:"mfa_token"`
	StaffID  string               `json:"staff_id"`
	Role     string               `json:"role"`
	Session  webauthn.SessionData `json:"session"`
}

const (
	redisKeyWAReg      = "wa:staff:reg:"
	redisKeyWAMFALogin = "wa:staff:mfa_login:"
	webauthnSessionTTL = mfaPendingTTL
)

func randomRedisKey() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "fallback-key"
	}
	return hex.EncodeToString(b[:])
}

func redisGetJSON[T any](ctx context.Context, rdb *redis.Client, key string) (*T, error) {
	s, err := rdb.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	var v T
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func redisSetJSON(ctx context.Context, rdb *redis.Client, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return rdb.Set(ctx, key, b, webauthnSessionTTL).Err()
}
