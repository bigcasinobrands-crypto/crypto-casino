// Package cryptokit provides AES-GCM symmetric encryption helpers used to
// protect PII-adjacent fields at rest (e.g. crypto withdrawal destination
// addresses).
//
// Today the master key is supplied via the WALLET_ADDRESS_KEK environment
// variable (32-byte hex). In production we expect to migrate to Vault
// Transit by swapping `Encrypt` / `Decrypt` for a Transit `encrypt/<key>` /
// `decrypt/<key>` round-trip; the calling sites will be unaffected because
// the wire format (nonce-prefixed AES-GCM ciphertext) and the public
// function signatures stay the same.
package cryptokit

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// ErrKeyMissing means no encryption key has been configured. Callers that
// require encryption should fail closed when this is returned.
var ErrKeyMissing = errors.New("cryptokit: no encryption key configured (set WALLET_ADDRESS_KEK)")

// AddressCipher wraps an AES-GCM key. Construct via NewAddressCipher; pass
// the resulting handle wherever ciphertext writes are needed.
type AddressCipher struct {
	gcm cipher.AEAD
}

// NewAddressCipher parses a 32-byte hex key and returns an initialized
// AES-256-GCM cipher. An empty key returns a nil cipher and ErrKeyMissing
// so callers can detect "encryption disabled" without crashing — useful in
// dev where the secret is not provisioned. Production should assert the
// key is set at startup.
func NewAddressCipher(hexKey string) (*AddressCipher, error) {
	hexKey = strings.TrimSpace(hexKey)
	if hexKey == "" {
		return nil, ErrKeyMissing
	}
	keyBytes, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("cryptokit: bad hex key: %w", err)
	}
	if len(keyBytes) != 32 {
		return nil, fmt.Errorf("cryptokit: key must be 32 bytes (got %d)", len(keyBytes))
	}
	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("cryptokit: aes.NewCipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cryptokit: cipher.NewGCM: %w", err)
	}
	return &AddressCipher{gcm: gcm}, nil
}

// Encrypt seals plaintext bytes. The returned slice is `nonce || ciphertext`
// where nonce is exactly gcm.NonceSize() bytes — Decrypt expects the same
// layout. Returns nil for empty input so callers can pass through "address
// not yet entered" cases.
func (c *AddressCipher) Encrypt(plaintext string) ([]byte, error) {
	if c == nil {
		return nil, ErrKeyMissing
	}
	if plaintext == "" {
		return nil, nil
	}
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("cryptokit: nonce: %w", err)
	}
	out := make([]byte, len(nonce), len(nonce)+len(plaintext)+c.gcm.Overhead())
	copy(out, nonce)
	out = c.gcm.Seal(out, nonce, []byte(plaintext), nil)
	return out, nil
}

// Decrypt unseals a `nonce || ciphertext` blob produced by Encrypt. Empty
// input returns the empty string so callers can blindly forward NULL
// ciphertexts through display paths.
func (c *AddressCipher) Decrypt(blob []byte) (string, error) {
	if c == nil {
		return "", ErrKeyMissing
	}
	if len(blob) == 0 {
		return "", nil
	}
	ns := c.gcm.NonceSize()
	if len(blob) < ns+c.gcm.Overhead() {
		return "", fmt.Errorf("cryptokit: ciphertext too short")
	}
	nonce := blob[:ns]
	ct := blob[ns:]
	pt, err := c.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("cryptokit: decrypt: %w", err)
	}
	return string(pt), nil
}

// HashAddress returns a deterministic sha256 hex of the *normalized*
// (lowercase, trimmed) address. Used for sanctions-list lookups and
// dedup-detection without ever decrypting the stored ciphertext. Returns
// the empty string for empty input.
func HashAddress(addr string) string {
	addr = strings.ToLower(strings.TrimSpace(addr))
	if addr == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(addr))
	return hex.EncodeToString(sum[:])
}

// Last4 returns the last four characters of the address, safe to render in
// UI for player verification. Returns the full string when shorter than 4.
func Last4(addr string) string {
	addr = strings.TrimSpace(addr)
	if len(addr) <= 4 {
		return addr
	}
	return addr[len(addr)-4:]
}
