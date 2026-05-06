package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/passhash"
	"github.com/crypto-casino/core/internal/pii"
	"github.com/crypto-casino/core/internal/playerauth"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintf(os.Stderr, "usage: playerbootstrap <email> <password>\n")
		os.Exit(1)
	}
	email := strings.ToLower(strings.TrimSpace(os.Args[1]))
	password := os.Args[2]
	if email == "" {
		log.Fatal("email required")
	}
	if err := playerauth.ValidatePassword(password); err != nil {
		log.Fatal("password must be at least 12 characters with letters and numbers")
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx := context.Background()
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()
	var taken bool
	_ = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE lower(email)=lower($1))`, email).Scan(&taken)
	if taken {
		log.Printf("player already exists: %s", email)
		return
	}
	hashStr, err := passhash.Hash(password)
	if err != nil {
		log.Fatal(err)
	}
	var emailHMAC interface{}
	if b := pii.EmailLookupHMACBytes(cfg.PIIEmailLookupSecret, email); len(b) > 0 {
		emailHMAC = b
	}
	var userID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, terms_accepted_at, terms_version, privacy_version, email_verified_at, email_hmac)
		VALUES ($1, $2, now(), '1', '1', now(), $3) RETURNING id::text
	`, email, hashStr, emailHMAC).Scan(&userID)
	if err != nil {
		log.Fatalf("insert: %v", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
		VALUES ($1::uuid, NULL, 0, 0, now())
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	if err != nil {
		log.Fatalf("player_vip_state: %v", err)
	}
	log.Printf("created player: %s", email)
}
