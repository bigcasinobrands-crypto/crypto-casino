package challenges

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AwardPrizeIfNeeded credits wallet for cash prizes when not in manual review.
// If forceDespiteManualReview is true (admin award), prize_manual_review is ignored; self-exclusion still blocks.
func AwardPrizeIfNeeded(ctx context.Context, pool *pgxpool.Pool, entryID, challengeID, userID string, forceDespiteManualReview bool) error {
	var manual bool
	var prizeType, currency string
	var prizeMinor *int64
	var selfEx *time.Time
	err := pool.QueryRow(ctx, `
		SELECT c.prize_manual_review, c.prize_type, c.prize_currency, c.prize_amount_minor,
		       u.self_excluded_until
		FROM challenges c
		CROSS JOIN users u
		WHERE c.id = $1::uuid AND u.id = $2::uuid
	`, challengeID, userID).Scan(&manual, &prizeType, &currency, &prizeMinor, &selfEx)
	if err != nil {
		return err
	}
	if manual && !forceDespiteManualReview {
		return nil
	}
	if selfEx != nil && selfEx.After(time.Now()) {
		return errors.New("user self-excluded")
	}
	var already *int64
	_ = pool.QueryRow(ctx, `SELECT prize_awarded_minor FROM challenge_entries WHERE id = $1::uuid`, entryID).Scan(&already)
	if already != nil && *already > 0 {
		return nil
	}
	if prizeType != "cash" {
		// bonus / free_spins / pool — admin or follow-up integration
		return nil
	}
	if prizeMinor == nil || *prizeMinor <= 0 {
		return nil
	}
	ccy := strings.TrimSpace(currency)
	if ccy == "" {
		ccy = "USDT"
	}
	var chTitle, chSlug string
	_ = pool.QueryRow(ctx, `SELECT title, COALESCE(slug, '') FROM challenges WHERE id = $1::uuid`, challengeID).Scan(&chTitle, &chSlug)
	idem := fmt.Sprintf("challenge:prize:%s:%s", challengeID, entryID)
	meta := map[string]any{
		"challenge_id": challengeID, "entry_id": entryID,
		"challenge_title": chTitle, "challenge_slug": chSlug,
	}
	_, err = ledger.ApplyCredit(ctx, pool, userID, ccy, "challenge.prize", idem, *prizeMinor, meta)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		UPDATE challenge_entries SET prize_awarded_minor = $2, prize_awarded_at = now(), updated_at = now()
		WHERE id = $1::uuid
	`, entryID, *prizeMinor)
	return err
}
