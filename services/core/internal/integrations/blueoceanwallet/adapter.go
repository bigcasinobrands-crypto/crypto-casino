package blueoceanwallet

import (
	"context"
	"fmt"

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
	if a == nil || a.Pool == nil || remoteID == "" {
		return "", fmt.Errorf("missing remote")
	}
	var uid string
	err := a.Pool.QueryRow(ctx, `
		SELECT user_id::text FROM blueocean_player_links WHERE remote_player_id = $1
	`, remoteID).Scan(&uid)
	if err == nil && uid != "" {
		return uid, nil
	}
	err = a.Pool.QueryRow(ctx, `SELECT id::text FROM users WHERE id::text = $1`, remoteID).Scan(&uid)
	if err == nil && uid != "" {
		return uid, nil
	}
	if err != nil {
		return "", err
	}
	return "", fmt.Errorf("user not found")
}
