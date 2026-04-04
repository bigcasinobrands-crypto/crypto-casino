package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintf(os.Stderr, "usage: resetstaffpw <email> <new-password>\n")
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
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal(err)
	}
	tag, err := pool.Exec(ctx, `
		UPDATE staff_users SET password_hash = $1 WHERE lower(email) = lower($2)
	`, string(hash), email)
	if err != nil {
		log.Fatalf("update: %v", err)
	}
	if tag.RowsAffected() == 0 {
		log.Fatalf("no staff_users row for email %q (create one with cmd/bootstrap first)", email)
	}
	log.Printf("password updated for %s", email)
}
