// Package bonuse2e is only for opt-in E2E tests; do not import from production code paths.
package bonuse2e

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DSN is the same env the bonus package tests use.
const DsnEnv = "BONUS_E2E_DATABASE_URL"

// MustPool connects, runs migrations, returns pool, or t.Fatal. Skip when DsnEnv unset.
func MustPool(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()
	dsn := os.Getenv(DsnEnv)
	if dsn == "" {
		t.Skip("set " + DsnEnv)
	}
	ctx := context.Background()
	if err := db.RunMigrations(dsn); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	p, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	return p, func() { p.Close() }
}

// UserFixedGrantResult is a seeded user with one active no-deposit grant (1000 minor, 1x WR) for E2E flows.
type UserFixedGrantResult struct {
	Pool      *pgxpool.Pool
	Ctx       context.Context
	UserID    string
	PromoID   int64
	PV        int64
	Instance  string
	Idem      string
	ClosePool func()
	Cleanup   func() // run after test: deletes instances, ledger, risk, promotion (not user)
}

// NewUserWithFixedNoDepositGrant inserts a user, promotion+version, and grants 1000 USDT bonus (active WR).
// Caller must t.Cleanup(res.Cleanup) in addition to res.ClosePool if both are set.
func NewUserWithFixedNoDepositGrant(t *testing.T) *UserFixedGrantResult {
	t.Helper()
	p, cl := MustPool(t)
	ctx := context.Background()
	uid := uuid.New().String()
	email := "e2e-bns-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC().Add(-2*time.Hour)); err != nil {
		cl()
		t.Fatal(err)
	}
	rules := `{
		"trigger": {"type": "custom"},
		"reward": {"type": "fixed", "fixed_minor": 1000},
		"wagering": {"multiplier": 1, "max_bet_minor": 100000, "game_weight_pct": 100}
	}`
	slug := "e2e-" + uid[:8]
	var promoID int64
	if err := p.QueryRow(ctx, `
		INSERT INTO promotions (name, slug, status) VALUES ($1, $2, 'draft') RETURNING id
	`, slug, "slug-"+uid).Scan(&promoID); err != nil {
		cl()
		t.Fatal(err)
	}
	var pvid int64
	if err := p.QueryRow(ctx, `
		INSERT INTO promotion_versions (promotion_id, version, rules, published_at, bonus_type)
		VALUES ($1, 1, $2::jsonb, now(), 'no_deposit') RETURNING id
	`, promoID, rules).Scan(&pvid); err != nil {
		cl()
		t.Fatal(err)
	}
	idem := "e2e:bonuse2e:" + uid
	ins, err := bonus.GrantFromPromotionVersion(ctx, p, bonus.GrantArgs{
		UserID: uid, PromotionVersionID: pvid, IdempotencyKey: idem,
		GrantAmountMinor: 1000, Currency: "USDT", DepositAmountMinor: 0,
	})
	if err != nil {
		cl()
		t.Fatal(err)
	}
	if !ins {
		t.Fatal("expected grant")
	}
	var instID string
	if err := p.QueryRow(ctx, `SELECT id::text FROM user_bonus_instances WHERE idempotency_key = $1`, idem).Scan(&instID); err != nil {
		cl()
		t.Fatal(err)
	}
	cleanup := func() {
		_, _ = p.Exec(ctx, `DELETE FROM blueocean_wallet_transactions WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM user_bonus_instances WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM bonus_risk_decisions WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM promotion_versions WHERE promotion_id = $1`, promoID)
		_, _ = p.Exec(ctx, `DELETE FROM promotions WHERE id = $1`, promoID)
	}
	return &UserFixedGrantResult{
		Pool: p, Ctx: ctx, UserID: uid, PromoID: promoID, PV: pvid, Instance: instID, Idem: idem,
		ClosePool: cl, Cleanup: cleanup,
	}
}

// RegisterCleanup runs Cleanup then closes the pool at the end of the test.
func (r *UserFixedGrantResult) RegisterCleanup(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		if r == nil {
			return
		}
		if r.Cleanup != nil {
			r.Cleanup()
		}
		if r.ClosePool != nil {
			r.ClosePool()
		}
	})
}
