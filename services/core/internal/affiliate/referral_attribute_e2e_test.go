package affiliate

import (
	"context"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/google/uuid"
)

// E2E attribution against a real DB (set BONUS_E2E_DATABASE_URL). Covers happy path,
// self-referral no-op, duplicate calls, inactive partner, and unknown code (no error from Tx).
func TestAttributeReferralTx_E2E(t *testing.T) {
	p, closePool := bonuse2e.MustPool(t)
	defer closePool()
	ctx := context.Background()

	refCode := "E2EREF" + uuid.New().String()[:8]
	uidPartner := uuid.New().String()
	uidReferee := uuid.New().String()
	emailA := "e2e-aff-a-" + uidPartner + "@e2e.local"
	emailB := "e2e-aff-b-" + uidReferee + "@e2e.local"
	now := time.Now().UTC()

	_, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1'),
		       ($4::uuid, $5, 'x', $3, now(), '1', '1')
	`, uidPartner, emailA, now, uidReferee, emailB)
	if err != nil {
		t.Fatal(err)
	}

	var tierID int
	if err := p.QueryRow(ctx, `
		SELECT id FROM referral_program_tiers WHERE active ORDER BY sort_order ASC, id ASC LIMIT 1
	`).Scan(&tierID); err != nil {
		t.Fatal(err)
	}

	var partnerID string
	if err := p.QueryRow(ctx, `
		INSERT INTO affiliate_partners (user_id, referral_code, display_name, revenue_share_bps, status, tier_id)
		VALUES ($1::uuid, $2, '', 500, 'active', $3)
		RETURNING id::text
	`, uidPartner, refCode, tierID).Scan(&partnerID); err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		_, _ = p.Exec(ctx, `DELETE FROM affiliate_referrals WHERE user_id = $1::uuid`, uidReferee)
		_, _ = p.Exec(ctx, `DELETE FROM affiliate_partners WHERE id = $1::uuid`, partnerID)
		_, _ = p.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, uidPartner)
		_, _ = p.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, uidReferee)
	})

	t.Run("happy_path", func(t *testing.T) {
		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := AttributeReferralTx(ctx, tx, uidReferee, refCode); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var n int
		_ = p.QueryRow(ctx, `SELECT COUNT(*) FROM affiliate_referrals WHERE user_id = $1::uuid`, uidReferee).Scan(&n)
		if n != 1 {
			t.Fatalf("expected 1 referral row, got %d", n)
		}
	})

	t.Run("duplicate_referee_noop", func(t *testing.T) {
		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := AttributeReferralTx(ctx, tx, uidReferee, refCode); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var n int
		_ = p.QueryRow(ctx, `SELECT COUNT(*) FROM affiliate_referrals WHERE user_id = $1::uuid`, uidReferee).Scan(&n)
		if n != 1 {
			t.Fatalf("still want 1 referral row, got %d", n)
		}
	})

	t.Run("self_referral_skipped", func(t *testing.T) {
		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := AttributeReferralTx(ctx, tx, uidPartner, refCode); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var n int
		_ = p.QueryRow(ctx, `SELECT COUNT(*) FROM affiliate_referrals WHERE user_id = $1::uuid`, uidPartner).Scan(&n)
		if n != 0 {
			t.Fatalf("expected no self-referral, got %d", n)
		}
	})

	t.Run("inactive_partner", func(t *testing.T) {
		uidC := uuid.New().String()
		emailC := "e2e-aff-c-" + uidC + "@e2e.local"
		if _, err := p.Exec(ctx, `
			INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
			VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
		`, uidC, emailC, now); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = p.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, uidC)
		})
		if _, err := p.Exec(ctx, `UPDATE affiliate_partners SET status = 'suspended' WHERE id = $1::uuid`, partnerID); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = p.Exec(ctx, `UPDATE affiliate_partners SET status = 'active' WHERE id = $1::uuid`, partnerID)
		})

		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := AttributeReferralTx(ctx, tx, uidC, refCode); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var n int
		_ = p.QueryRow(ctx, `SELECT COUNT(*) FROM affiliate_referrals WHERE user_id = $1::uuid`, uidC).Scan(&n)
		if n != 0 {
			t.Fatalf("inactive partner should not attribute, got %d rows", n)
		}
	})

	t.Run("unknown_code_no_error", func(t *testing.T) {
		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := AttributeReferralTx(ctx, tx, uidReferee, "ZZZZNOTREAL999"); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		_ = tx.Rollback(ctx)
	})
}
