package db

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	if v := strings.TrimSpace(os.Getenv("DATABASE_POOL_MAX_CONNS")); v != "" {
		n, aerr := strconv.Atoi(v)
		if aerr == nil && n >= 4 && n <= 500 {
			cfg.MaxConns = int32(n)
		}
	} else {
		if cfg.MaxConns == 0 {
			cfg.MaxConns = 32
		} else if cfg.MaxConns < 32 {
			// Hosting templates often embed pool_max_conns=4 in DATABASE_URL — too few when many seamless
			// wallet callbacks wait on one player's row lock.
			cfg.MaxConns = 32
		}
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}
