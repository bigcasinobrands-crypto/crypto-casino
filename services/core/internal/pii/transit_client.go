package pii

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Transit talks to Vault's Transit secrets engine over HTTP (no heavy Vault SDK).
type Transit struct {
	BaseURL string
	Token   string
	Mount   string
	Key     string
	HTTP    *http.Client
}

func NewTransit(baseURL, token, mount, key string) *Transit {
	baseURL = strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if mount == "" {
		mount = "transit"
	}
	return &Transit{
		BaseURL: baseURL,
		Token:   strings.TrimSpace(token),
		Mount:   strings.TrimSpace(mount),
		Key:     strings.TrimSpace(key),
		HTTP:    &http.Client{Timeout: 15 * time.Second},
	}
}

func (t *Transit) enabled() bool {
	return t != nil && t.BaseURL != "" && t.Token != "" && t.Key != "" && t.HTTP != nil
}

const transitMaxAttempts = 3

func (t *Transit) transientHTTP(code int) bool {
	return code == http.StatusTooManyRequests || code >= http.StatusInternalServerError
}

// postVaultTransit executes POST with retries on network errors and 5xx/429.
func (t *Transit) postVaultTransit(ctx context.Context, path string, jsonBody []byte) ([]byte, int, error) {
	var lastErr error
	var lastCode int
	for attempt := 0; attempt < transitMaxAttempts; attempt++ {
		if attempt > 0 {
			delay := time.Duration(50*(1<<attempt)) * time.Millisecond
			select {
			case <-ctx.Done():
				return nil, 0, ctx.Err()
			case <-time.After(delay):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, path, bytes.NewReader(jsonBody))
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("X-Vault-Token", t.Token)
		req.Header.Set("Content-Type", "application/json")
		resp, err := t.HTTP.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		b, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		lastCode = resp.StatusCode
		if resp.StatusCode == http.StatusOK {
			return b, resp.StatusCode, nil
		}
		if !t.transientHTTP(resp.StatusCode) {
			return b, resp.StatusCode, fmt.Errorf("vault transit: HTTP %d: %s", resp.StatusCode, string(b))
		}
		lastErr = fmt.Errorf("vault transit: HTTP %d: %s", resp.StatusCode, string(b))
	}
	if lastErr != nil {
		return nil, lastCode, lastErr
	}
	return nil, lastCode, fmt.Errorf("vault transit: exhausted retries (last HTTP %d)", lastCode)
}

// Encrypt returns the Vault ciphertext string (e.g. vault:v1:...).
func (t *Transit) Encrypt(ctx context.Context, plaintext []byte) (string, error) {
	if !t.enabled() {
		return "", errors.New("vault transit not configured")
	}
	if len(plaintext) == 0 {
		return "", errors.New("empty plaintext")
	}
	b64 := base64.StdEncoding.EncodeToString(plaintext)
	path := fmt.Sprintf("%s/v1/%s/encrypt/%s", t.BaseURL, strings.Trim(t.Mount, "/"), strings.Trim(t.Key, "/"))
	raw, err := json.Marshal(map[string]string{"plaintext": b64})
	if err != nil {
		return "", err
	}
	b, _, err := t.postVaultTransit(ctx, path, raw)
	if err != nil {
		return "", err
	}
	var wrap struct {
		Data struct {
			Ciphertext string `json:"ciphertext"`
		} `json:"data"`
	}
	if err := json.Unmarshal(b, &wrap); err != nil {
		return "", err
	}
	if wrap.Data.Ciphertext == "" {
		return "", errors.New("vault: empty ciphertext")
	}
	slog.DebugContext(ctx, "vault_transit_encrypt", "mount", t.Mount, "key", t.Key, "plaintext_len", len(plaintext))
	return wrap.Data.Ciphertext, nil
}

// Decrypt turns a Vault ciphertext back into plaintext (controlled back-office paths only).
func (t *Transit) Decrypt(ctx context.Context, ciphertext string) ([]byte, error) {
	if !t.enabled() {
		return nil, errors.New("vault transit not configured")
	}
	ciphertext = strings.TrimSpace(ciphertext)
	if ciphertext == "" {
		return nil, errors.New("empty ciphertext")
	}
	path := fmt.Sprintf("%s/v1/%s/decrypt/%s", t.BaseURL, strings.Trim(t.Mount, "/"), strings.Trim(t.Key, "/"))
	raw, err := json.Marshal(map[string]string{"ciphertext": ciphertext})
	if err != nil {
		return nil, err
	}
	b, _, err := t.postVaultTransit(ctx, path, raw)
	if err != nil {
		return nil, err
	}
	var wrap struct {
		Data struct {
			Plaintext string `json:"plaintext"`
		} `json:"data"`
	}
	if err := json.Unmarshal(b, &wrap); err != nil {
		return nil, err
	}
	out, err := base64.StdEncoding.DecodeString(wrap.Data.Plaintext)
	if err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "vault_transit_decrypt", "mount", t.Mount, "key", t.Key, "plaintext_len", len(out))
	return out, nil
}
