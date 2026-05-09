package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// supabaseSessionPoolerMaxClients returns a hard cap for Supabase's *session-mode* pooler
// (host *.pooler.supabase.com port 5432). Plans enforce a small pool_size; exceeding it yields
// FATAL ... EMAXCONNSESSION ... max clients reached in session mode.
// Port 6543 is transaction-mode pooler (much higher client concurrency) — no cap here.
// Override cap with SUPABASE_SESSION_POOL_MAX_CONNS when Supabase raises your limit.
func supabaseSessionPoolerMaxClients(cfg *pgxpool.Config) int32 {
	if cfg == nil || cfg.ConnConfig == nil {
		return 0
	}
	host := strings.ToLower(strings.TrimSpace(cfg.ConnConfig.Host))
	if !strings.Contains(host, "pooler.supabase.com") {
		return 0
	}
	if cfg.ConnConfig.Port != 5432 {
		return 0
	}
	if v := strings.TrimSpace(os.Getenv("SUPABASE_SESSION_POOL_MAX_CONNS")); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil && n >= 1 && n <= 500 {
			return int32(n)
		}
	}
	// Stay under typical Supabase session pooler pool_size so rolling deploys can run goose while
	// the previous instance still holds connections (see MIGRATE_DATABASE_URL for a stronger fix).
	return 10
}

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
	if capN := supabaseSessionPoolerMaxClients(cfg); capN > 0 && cfg.MaxConns > capN {
		log.Printf("db pool: capping MaxConns %d -> %d (Supabase session pooler limit; use port 6543 transaction pooler for higher concurrency or set SUPABASE_SESSION_POOL_MAX_CONNS)", cfg.MaxConns, capN)
		cfg.MaxConns = capN
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
