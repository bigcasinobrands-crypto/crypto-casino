package games

import (
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Server holds dependencies for list/launch handlers.
type Server struct {
	Pool *pgxpool.Pool
	BOG  *blueocean.Client
	Cfg  *config.Config
}

func NewServer(pool *pgxpool.Pool, bog *blueocean.Client, cfg *config.Config) *Server {
	return &Server{Pool: pool, BOG: bog, Cfg: cfg}
}
