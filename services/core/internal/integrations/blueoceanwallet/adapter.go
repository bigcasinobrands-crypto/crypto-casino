package blueoceanwallet

import (
	"context"
	"fmt"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/ports"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Adapter implements ports.SeamlessWalletPort for BlueOcean seamless wallet GET callbacks.
type Adapter struct {
	Pool *pgxpool.Pool
}

var _ ports.SeamlessWalletPort = (*Adapter)(nil)

func (a *Adapter) ProviderKey() string {
	return "blueocean_v1"
}

func (a *Adapter) ParseRemoteUser(ctx context.Context, remoteID string) (string, error) {
	if a == nil || a.Pool == nil {
		return "", fmt.Errorf("missing remote")
	}
	return blueocean.ResolveWalletRemoteToUserID(ctx, a.Pool, remoteID)
}
