// Command bog-player-backfill runs createPlayer + blueocean_player_links for users missing a link.
//
// Skips accounts with account_closed_at set. Uses the same EnsurePlayerLink path as register/launch.
//
//	cd services/core && go run ./cmd/bog-player-backfill -dry-run
//	go run ./cmd/bog-player-backfill -limit=500 -sleep-ms=300
//
// Env: DATABASE_URL, BLUEOCEAN_API_* (same as API). For large cohorts, prefer smaller batches and repeat.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "list how many users need links; no XAPI calls")
	limit := flag.Int("limit", 0, "max users to process (0 = all missing links)")
	sleepMs := flag.Int("sleep-ms", 250, "milliseconds to sleep after each successful provision (0 = none)")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	bog := blueocean.NewClient(&cfg)
	if bog == nil || !bog.Configured() {
		log.Fatal("Blue Ocean XAPI not configured — set BLUEOCEAN_API_BASE_URL, BLUEOCEAN_API_LOGIN, BLUEOCEAN_API_PASSWORD")
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	missing, err := blueocean.CountUsersMissingBlueOceanLink(ctx, pool)
	if err != nil {
		log.Fatalf("count missing links: %v", err)
	}
	fmt.Printf("users missing blueocean_player_links (open accounts): %d\n", missing)
	if *dryRun {
		ok, _, err := blueocean.BackfillMissingPlayerLinks(ctx, pool, bog, &cfg, blueocean.BackfillMissingPlayerLinksOptions{
			Limit:  *limit,
			DryRun: true,
		})
		if err != nil {
			log.Fatalf("dry-run: %v", err)
		}
		fmt.Printf("dry-run candidates that would be processed (with current limit): %d\n", ok)
		return
	}

	sleep := time.Duration(*sleepMs) * time.Millisecond
	ok, fail, err := blueocean.BackfillMissingPlayerLinks(ctx, pool, bog, &cfg, blueocean.BackfillMissingPlayerLinksOptions{
		Limit:        *limit,
		DryRun:       false,
		SleepBetween: sleep,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "backfill stopped: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("provisioned OK: %d, failed: %d\n", ok, fail)
	if fail > 0 {
		os.Exit(2)
	}
}
