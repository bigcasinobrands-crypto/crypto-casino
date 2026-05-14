package adminops

import (
	"context"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/google/uuid"
)

// TestE2ENGRBreakdownLedgerRules requires BONUS_E2E_DATABASE_URL (migrated Postgres).
func TestE2ENGRBreakdownLedgerRules(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()

	uidOK := uuid.New().String()
	uidExcluded := uuid.New().String()
	emailOK := "ngr-e2e-" + uidOK[:8] + "@e2e.local"
	emailEx := "ngr-ex-" + uidExcluded[:8] + "@e2e.local"
	ts := time.Now().UTC()

	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version, exclude_from_dashboard_analytics)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1', false)
	`, uidOK, emailOK, ts); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version, exclude_from_dashboard_analytics)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1', true)
	`, uidExcluded, emailEx, ts); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(ctx, `DELETE FROM ledger_entries WHERE user_id IN ($1::uuid, $2::uuid)`, uidOK, uidExcluded)
		_, _ = p.Exec(ctx, `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, uidOK, uidExcluded)
	})

	ins := func(uid, idem, entryType string, amountMinor int64, pocket string) {
		t.Helper()
		if _, err := p.Exec(ctx, `
			INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, pocket, created_at)
			VALUES ($1::uuid, $2, 'EUR', $3, $4, $5, $6)
		`, uid, amountMinor, entryType, idem, pocket, ts); err != nil {
			t.Fatal(err)
		}
	}

	// GGR = 1000 stakes - 400 wins = 600; bonus cost 100 → NGR 500
	ins(uidOK, "ngr-e2e:stake", "game.debit", -1000, "cash")
	ins(uidOK, "ngr-e2e:win", "game.credit", 400, "cash")
	ins(uidOK, "ngr-e2e:bonus", "promo.grant", 100, "bonus_locked")
	// Deposit must not hit GGR
	ins(uidOK, "ngr-e2e:dep", "deposit.credit", 50_000, "cash")
	// BO compatibility balance reset (not player win economics)
	ins(uidOK, "blueocean:"+uidOK+":remote:debit_reset:ledger-txn-1", "game.credit", 1_000_000_000, "cash")
	// Excluded user would dominate if counted
	ins(uidExcluded, "ngr-e2e:exstake", "game.debit", -9_000_000, "cash")

	start := ts.Add(-30 * time.Minute)
	end := ts.Add(30 * time.Minute)

	b, err := queryDashboardNGRBreakdown(ctx, p, start, end, false)
	if err != nil {
		t.Fatal(err)
	}
	if b.SettledBetsMinor != 1000 {
		t.Fatalf("settled bets = %d want 1000", b.SettledBetsMinor)
	}
	if b.SettledWinsMinor != 400 {
		t.Fatalf("settled wins = %d want 400 (debit_reset credit excluded)", b.SettledWinsMinor)
	}
	if b.GGR != 600 {
		t.Fatalf("GGR = %d want 600", b.GGR)
	}
	if b.BonusCost != 100 {
		t.Fatalf("bonus cost = %d want 100", b.BonusCost)
	}
	if want := int64(500); ngrTotalFromBreakdown(b) != want {
		t.Fatalf("NGR = %d want %d", ngrTotalFromBreakdown(b), want)
	}
}

func TestE2ENGRLedgerRollbackNetZero(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "ngr-rb-" + uid[:8] + "@e2e.local"
	ts := time.Now().UTC()
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, ts); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(ctx, `DELETE FROM ledger_entries WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, uid)
	})
	if _, err := p.Exec(ctx, `
		INSERT INTO ledger_entries (user_id, amount_minor, currency, entry_type, idempotency_key, pocket, created_at)
		VALUES
		 ($1::uuid, -500, 'EUR', 'game.debit', $2, 'cash', $3),
		 ($1::uuid, 500, 'EUR', 'game.rollback', $4, 'cash', $3)
	`, uid, "ngr-rb:debit:"+uid, ts, "ngr-rb:rollback:"+uid); err != nil {
		t.Fatal(err)
	}
	start := ts.Add(-30 * time.Minute)
	end := ts.Add(30 * time.Minute)
	b, err := queryDashboardNGRBreakdown(ctx, p, start, end, false)
	if err != nil {
		t.Fatal(err)
	}
	if b.SettledBetsMinor != 0 {
		t.Fatalf("settled bets after rollback want 0 got %d", b.SettledBetsMinor)
	}
	if b.GGR != 0 {
		t.Fatalf("GGR want 0 got %d", b.GGR)
	}
}
