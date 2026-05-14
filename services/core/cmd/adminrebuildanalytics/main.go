// Command adminrebuildanalytics is the production-safe "rebuild" for admin casino analytics.
//
// This service does not persist pre-aggregated KPI rows: GET /v1/admin/dashboard/casino-analytics
// recomputes from ledger_entries on each request. There is therefore no dashboard KPI cache or
// aggregate table to truncate in-app. This CLI documents that and optionally runs ANALYZE on
// ledger_entries so the planner has fresh stats after large backfills.
//
// Usage (from services/core with DATABASE_URL set):
//
//	go run ./cmd/adminrebuildanalytics
//	go run ./cmd/adminrebuildanalytics --analyze
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	doAnalyze := flag.Bool("analyze", false, "run ANALYZE ledger_entries after printing the rebuild plan")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db pool: %v", err)
	}
	defer pool.Close()

	fmt.Fprintln(os.Stdout, "admin:rebuild-analytics")
	fmt.Fprintln(os.Stdout, "- No in-process Redis/dashboard KPI cache is used for casino analytics.")
	fmt.Fprintln(os.Stdout, "- No materialized finance aggregate tables are maintained for NGR/GGR in core.")
	fmt.Fprintln(os.Stdout, "- Figures always read from ledger_entries (+ users / reward_programs for filters and splits).")
	fmt.Fprintln(os.Stdout, "- To verify live numbers vs the dashboard, call GET /v1/admin/debug/analytics-breakdown (superadmin).")
	if *doAnalyze {
		if _, err := pool.Exec(ctx, `ANALYZE ledger_entries`); err != nil {
			log.Fatalf("ANALYZE ledger_entries: %v", err)
		}
		fmt.Fprintln(os.Stdout, "OK: ANALYZE ledger_entries completed.")
	} else {
		fmt.Fprintln(os.Stdout, "Done (no --analyze). Re-run with --analyze to refresh table statistics.")
	}
}
