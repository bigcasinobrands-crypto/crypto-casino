package e2e

import (
	"context"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/google/uuid"
)

// TestE2EFreeSpinGrantList wires migration free_spin_grants + idempotent insert + list
// (R3 local ledger). Requires BONUS_E2E_DATABASE_URL.
func TestE2EFreeSpinGrantList(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "e2e-fsfs-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(ctx, `DELETE FROM free_spin_grants WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, uid)
	})
	idem := "e2e:fs:" + uid
	_, _, err := bonus.InsertFreeSpinGrant(ctx, p, uid, nil, idem, "game-1", 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := bonus.ListFreeSpinGrantsForUser(ctx, p, uid, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 grant, got %d", len(rows))
	}
	if rt, ok := rows[0]["rounds_total"].(int64); !ok || rt != 10 {
		t.Fatalf("rounds_total: %#v", rows[0])
	}
}
