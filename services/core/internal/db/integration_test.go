//go:build integration

package db_test

import (
	"os"
	"testing"

	"github.com/crypto-casino/core/internal/db"
)

// TestMigrationsApply runs goose migrations against DATABASE_URL (CI service container).
func TestMigrationsApply(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	if err := db.RunMigrations(dsn); err != nil {
		t.Fatal(err)
	}
}
