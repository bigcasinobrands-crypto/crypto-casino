package jtiredis

import (
	"context"
	"time"

	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/redis/go-redis/v9"
)

const keyPrefix = "jwt:jti:rev:"

// Revoker stores revoked JTIs until TTL elapses.
type Revoker struct {
	Rdb *redis.Client
}

// Revoke marks jti as revoked until expiry (align with access token lifetime).
func (r *Revoker) Revoke(ctx context.Context, jti string, ttl time.Duration) error {
	if r == nil || r.Rdb == nil || jti == "" || ttl <= 0 {
		return nil
	}
	k := keyPrefix + jwtissuer.JTIHash(jti)
	return r.Rdb.Set(ctx, k, "1", ttl).Err()
}

// IsRevoked reports whether jti was revoked.
func (r *Revoker) IsRevoked(ctx context.Context, jti string) (bool, error) {
	if r == nil || r.Rdb == nil || jti == "" {
		return false, nil
	}
	k := keyPrefix + jwtissuer.JTIHash(jti)
	n, err := r.Rdb.Exists(ctx, k).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
