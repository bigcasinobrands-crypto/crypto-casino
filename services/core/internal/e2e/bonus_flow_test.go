package e2e

import (
	"context"
	"testing"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/bonuse2e"
)

// TestE2EGrantWageringAndComplete runs when BONUS_E2E_DATABASE_URL is set.
func TestE2EGrantWageringAndComplete(t *testing.T) {
	res := bonuse2e.NewUserWithFixedNoDepositGrant(t)
	res.RegisterCleanup(t)
	ctx := context.Background()
	uid, idem := res.UserID, res.Idem
	pool := res.Pool

	var instID string
	var wrReq, wrDone int64
	var st string
	err := pool.QueryRow(ctx, `
		SELECT id::text, wr_required_minor, wr_contributed_minor, status
		FROM user_bonus_instances WHERE user_id = $1::uuid AND idempotency_key = $2
	`, uid, idem).Scan(&instID, &wrReq, &wrDone, &st)
	if err != nil {
		t.Fatal(err)
	}
	if st != "active" || wrReq != 1000 || wrDone != 0 {
		t.Fatalf("unexpected instance: status=%s wr=%d/%d", st, wrDone, wrReq)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := bonus.ApplyPostBetWagering(ctx, tx, uid, "e2e-slot", 1000); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	err = pool.QueryRow(ctx, `SELECT status, wr_contributed_minor FROM user_bonus_instances WHERE id = $1::uuid`, instID).Scan(&st, &wrDone)
	if err != nil {
		t.Fatal(err)
	}
	if st != "completed" {
		t.Fatalf("expected completed after 1x WR met, got status=%s wr_done=%d", st, wrDone)
	}
	if wrDone < 1000 {
		t.Fatalf("expected wr_contributed at least 1000, got %d", wrDone)
	}
}
