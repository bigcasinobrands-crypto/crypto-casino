// Command migrate applies embedded Goose SQL migrations (same as API startup).
// Use when you want migrations without starting HTTP (e.g. CI job, kubectl Job, or debugging).
//
//	DATABASE_URL=... go run ./cmd/migrate
package main

import (
	"log"
	"os"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	log.Println("migrations: ok")
	os.Exit(0)
}
