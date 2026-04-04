package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/playerauth"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
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
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO users (email, password_hash, terms_accepted_at, terms_version, privacy_version, email_verified_at)
		VALUES ($1, $2, now(), '1', '1', now())
	`, email, string(hash))
	if err != nil {
		log.Fatalf("insert: %v", err)
	}
	log.Printf("created player: %s", email)
}
