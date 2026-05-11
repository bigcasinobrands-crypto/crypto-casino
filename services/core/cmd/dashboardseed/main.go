// Command dashboardseed inserts synthetic ledger rows so admin /v1/admin/dashboard/* KPIs
// show non-zero activity (local / staging only).
//
// Usage:
//
//	ALLOW_DASHBOARD_DEMO_SEED=1 go run ./cmd/dashboardseed
//
// Requires at least one row in `users`. Create players with cmd/playerbootstrap first.
// Refuses APP_ENV=production. Re-running is safe (idempotent keys).
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	raw := strings.TrimSpace(os.Getenv("ALLOW_DASHBOARD_DEMO_SEED"))
	if raw != "1" && !strings.EqualFold(raw, "true") {
		log.Fatal("set ALLOW_DASHBOARD_DEMO_SEED=1 to confirm dashboard KPI seeding")
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if cfg.AppEnv == "production" {
		log.Fatal("refusing to seed dashboard when APP_ENV=production")
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

	ccy := strings.ToUpper(strings.TrimSpace(cfg.BlueOceanCurrency))
	if ccy == "" {
		ccy = "EUR"
	}

	userIDs, err := loadRecentUserIDs(ctx, pool, 20)
	if err != nil {
		log.Fatalf("users: %v", err)
	}
	if len(userIDs) == 0 {
		log.Fatal("no users — create players first (see cmd/playerbootstrap)")
	}
	if len(userIDs) > 8 {
		userIDs = userIDs[:8]
	}

	const days = 30
	now := time.Now().UTC()
	var inserted int64
	for d := 0; d < days; d++ {
		dayAnchor := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, time.UTC).AddDate(0, 0, -d)

		for i, uid := range userIDs {
			// Sparse pattern so not every user fires every day (still plenty of volume).
			if d%2 != i%2 && d > 3 {
				continue
			}

			stake := int64(45_000 + d*800 + i*1_200)
			win := stake * 93 / 100
			tDebit := dayAnchor.Add(time.Duration(i*41+d*73) * time.Minute)
			tCredit := tDebit.Add(2 * time.Minute)

			idDebit := fmt.Sprintf("demo-dash:debit:%s:%d:%d", uid, d, i)
			idCredit := fmt.Sprintf("demo-dash:credit:%s:%d:%d", uid, d, i)

			n, err := insertLedger(ctx, pool, uid, ccy, ledger.EntryTypeGameDebit, idDebit, -stake, ledger.PocketCash, tDebit)
			if err != nil {
				log.Fatalf("game.debit: %v", err)
			}
			inserted += n
			n, err = insertLedger(ctx, pool, uid, ccy, ledger.EntryTypeGameCredit, idCredit, win, ledger.PocketCash, tCredit)
			if err != nil {
				log.Fatalf("game.credit: %v", err)
			}
			inserted += n

			if d%5 == i%5 {
				idDep := fmt.Sprintf("demo-dash:deposit:%s:%d:%d", uid, d, i)
				n, err = insertLedger(ctx, pool, uid, ccy, ledger.EntryTypeDepositCredit, idDep, 180_000+int64(d*500), ledger.PocketCash, tCredit.Add(30*time.Minute))
				if err != nil {
					log.Fatalf("deposit.credit: %v", err)
				}
				inserted += n
			}
			if d%9 == (i+2)%9 {
				idPromo := fmt.Sprintf("demo-dash:promo:%s:%d:%d", uid, d, i)
				n, err = insertLedger(ctx, pool, uid, ccy, ledger.EntryTypePromoGrant, idPromo, 22_000+int64(i*900), ledger.PocketBonusLocked, tCredit.Add(45*time.Minute))
				if err != nil {
					log.Fatalf("promo.grant: %v", err)
				}
				inserted += n
			}
		}
	}

	log.Printf("dashboardseed: inserted %d new ledger row(s) (%d player(s), last %d days); skipped rows already present", inserted, len(userIDs), days)
}

func loadRecentUserIDs(ctx context.Context, pool *pgxpool.Pool, limit int) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT id::text FROM users ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func insertLedger(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID, ccy, entryType, idempotencyKey string,
	amountMinor int64,
	pocket string,
	at time.Time,
) (int64, error) {
	pocket = ledger.NormalizePocket(pocket)
	tag, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, pocket, metadata, created_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, '{}'::jsonb, $7)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, userID, amountMinor, ccy, entryType, idempotencyKey, pocket, at)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
