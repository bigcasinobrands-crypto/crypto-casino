package integrations

import (
	"sync"

	"github.com/crypto-casino/core/internal/integrations/blueoceanwallet"
	"github.com/crypto-casino/core/internal/ports"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Registry maps integration kinds to concrete adapters. Wire once from cmd/api main.
type Registry struct {
	mu sync.RWMutex

	seamlessWallet ports.SeamlessWalletPort
}

// NewRegistry builds the default integration set for this binary.
func NewRegistry(pool *pgxpool.Pool) *Registry {
	r := &Registry{}
	if pool != nil {
		r.seamlessWallet = &blueoceanwallet.Adapter{Pool: pool}
	}
	return r
}

// SeamlessWallet returns the active seamless wallet implementation (BlueOcean today).
func (r *Registry) SeamlessWallet() ports.SeamlessWalletPort {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.seamlessWallet
}
