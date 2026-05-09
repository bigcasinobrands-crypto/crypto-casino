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
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintf(os.Stderr, "usage: bootstrap <email> <password>\n")
		os.Exit(1)
	}
	email := strings.ToLower(strings.TrimSpace(os.Args[1]))
	password := os.Args[2]
	if email == "" || len(password) < 8 {
		log.Fatal("email required and password min 8 characters")
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx := context.Background()
	if err := db.RunMigrations(cfg.DatabaseURLForMigrations()); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	var exists bool
	err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM staff_users WHERE lower(email) = $1)`, email).Scan(&exists)
	if err != nil {
		log.Fatalf("check user: %v", err)
	}
	if exists {
		log.Printf("staff user already exists: %s (use cmd/resetstaffpw to change password)", email)
		return
	}
	hashStr, err := passhash.Hash(password)
	if err != nil {
		log.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO staff_users (email, password_hash, role) VALUES ($1, $2, 'superadmin')
	`, email, hashStr)
	if err != nil {
		log.Fatalf("insert: %v", err)
	}
	log.Printf("created staff superadmin: %s", email)
}
