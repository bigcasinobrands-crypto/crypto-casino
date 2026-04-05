package fystack

import (
	"context"
	"sync"
	"time"
)

var (
	webhookKeyMu   sync.RWMutex
	cachedPubKey   string
	cachedPubKeyAt time.Time
)

// WebhookPublicKeyCached returns the workspace Ed25519 public key with in-memory TTL.
func (c *Client) WebhookPublicKeyCached(ctx context.Context, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	now := time.Now()
	webhookKeyMu.RLock()
	if cachedPubKey != "" && now.Sub(cachedPubKeyAt) < ttl {
		k := cachedPubKey
		webhookKeyMu.RUnlock()
		return k, nil
	}
	webhookKeyMu.RUnlock()

	k, err := c.GetWebhookPublicKey(ctx)
	if err != nil {
		return "", err
	}
	webhookKeyMu.Lock()
	cachedPubKey = k
	cachedPubKeyAt = now
	webhookKeyMu.Unlock()
	return k, nil
}
