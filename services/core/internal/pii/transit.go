package pii

import (
	"context"
	"errors"
	"sync"
)

var (
	muDefault sync.RWMutex
	defaultTC *Transit
)

// SetDefaultTransit registers a Transit client for package-level helpers.
func SetDefaultTransit(c *Transit) {
	muDefault.Lock()
	defer muDefault.Unlock()
	defaultTC = c
}

// TransitEncrypt encrypts using the default Transit client (see SetDefaultTransit).
func TransitEncrypt(ctx context.Context, _ string, plaintext []byte) ([]byte, error) {
	muDefault.RLock()
	tc := defaultTC
	muDefault.RUnlock()
	if tc == nil {
		return nil, errors.New("vault transit not configured")
	}
	s, err := tc.Encrypt(ctx, plaintext)
	if err != nil {
		return nil, err
	}
	return []byte(s), nil
}

// TransitDecrypt decrypts using the default Transit client. reason is reserved for audit extensions.
func TransitDecrypt(ctx context.Context, _, _ string, ciphertext []byte) ([]byte, error) {
	muDefault.RLock()
	tc := defaultTC
	muDefault.RUnlock()
	if tc == nil {
		return nil, errors.New("vault transit not configured")
	}
	return tc.Decrypt(ctx, string(ciphertext))
}
