package challenges

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ClaimPrize credits a completed entry when require_claim_for_prize is set and prize is cash (not manual review).
func ClaimPrize(ctx context.Context, pool *pgxpool.Pool, userID, challengeID string) error {
	var entryID, status string
	var reqClaim, manual bool
	var ptype string
	var awardedAt sql.NullTime
	err := pool.QueryRow(ctx, `
		SELECT e.id::text, e.status,
		       c.require_claim_for_prize, c.prize_manual_review, c.prize_type,
		       e.prize_awarded_at
		FROM challenge_entries e
		JOIN challenges c ON c.id = e.challenge_id
		WHERE e.user_id = $1::uuid AND e.challenge_id = $2::uuid
	`, userID, challengeID).Scan(&entryID, &status, &reqClaim, &manual, &ptype, &awardedAt)
	if err != nil {
		return fmt.Errorf("no entry for this challenge")
	}
	if status != "completed" {
		return errors.New("challenge not completed yet")
	}
	if !reqClaim {
		return errors.New("prize is paid automatically for this challenge; nothing to claim")
	}
	if manual {
		return errors.New("prize is pending staff review")
	}
	pt := strings.TrimSpace(strings.ToLower(ptype))
	if pt != "cash" && pt != "bonus" && pt != "free_spins" {
		return errors.New("claim is not available for this prize type")
	}
	if awardedAt.Valid {
		return errors.New("prize already claimed")
	}
	return AwardPrizeIfNeeded(ctx, pool, entryID, challengeID, userID, false)
}
