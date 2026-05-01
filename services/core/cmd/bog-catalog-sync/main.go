// Command bog-catalog-sync runs Blue Ocean getGameList and upserts into games (thumbnail_url, titles, flags).
//
// Loads env like the API (DATABASE_URL, BLUEOCEAN_*). Run from repo:
//
//	cd services/core && go run ./cmd/bog-catalog-sync
//
// Or use Admin → Integrations → Blue Ocean ops → Sync catalog (same POST handler).
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	bog := blueocean.NewClient(&cfg)
	snapshotPath := strings.TrimSpace(cfg.BlueOceanCatalogSnapshotPath)
	if snapshotPath == "" && (bog == nil || !bog.Configured()) {
		log.Fatal("Blue Ocean not configured — set BLUEOCEAN_API_* or BLUEOCEAN_CATALOG_SNAPSHOT_PATH for offline catalog")
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	n, err := blueocean.SyncCatalog(ctx, pool, bog, &cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sync failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("catalog sync OK: upserted %d game row(s)\n", n)
}
