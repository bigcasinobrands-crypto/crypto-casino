package bonus

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FreeSpinsV1Config is stored in bonus_config (key free_spins_v1).
// api_enabled: surface free-spin UI/API; outbound_enabled: worker may call Blue Ocean addFreeRounds.
type FreeSpinsV1Config struct {
	APIEnabled      bool `json:"api_enabled"`
	OutboundEnabled bool `json:"outbound_enabled"`
}

// LoadFreeSpinsV1Config reads from bonus_config. Missing row → both false (safe default).
func LoadFreeSpinsV1Config(ctx context.Context, pool *pgxpool.Pool) (FreeSpinsV1Config, error) {
	var b []byte
	err := pool.QueryRow(ctx, `SELECT value FROM bonus_config WHERE key = 'free_spins_v1'`).Scan(&b)
	if err == pgx.ErrNoRows {
		return FreeSpinsV1Config{}, nil
	}
	if err != nil {
		return FreeSpinsV1Config{}, err
	}
	var c FreeSpinsV1Config
	_ = json.Unmarshal(b, &c)
	return c, nil
}
