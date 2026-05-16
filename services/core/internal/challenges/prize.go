package challenges

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AwardPrizeIfNeeded credits prizes when not in manual review.
// If forceDespiteManualReview is true (admin award), prize_manual_review is ignored; self-exclusion still blocks.
func AwardPrizeIfNeeded(ctx context.Context, pool *pgxpool.Pool, entryID, challengeID, userID string, forceDespiteManualReview bool) error {
	var manual bool
	var prizeType, currency string
	var prizeMinor sql.NullInt64
	var wrMult int
	var maxBetPrize int64
	var withdrawPol sql.NullString
	var fsRounds sql.NullInt64
	var fsGame sql.NullString
	var fsBetMinor int64
	var gameIDs []string
	var selfEx sql.NullTime

	err := pool.QueryRow(ctx, `
		SELECT c.prize_manual_review, c.prize_type, c.prize_currency, c.prize_amount_minor,
			COALESCE(c.prize_wagering_multiplier, 0), COALESCE(c.prize_max_bet_minor, 0),
			c.prize_withdraw_policy, c.prize_free_spins, c.prize_free_spin_game_id,
			COALESCE(c.prize_bet_per_round_minor, 1),
			COALESCE(c.game_ids, '{}'::text[]),
			u.self_excluded_until
		FROM challenges c
		CROSS JOIN users u
		WHERE c.id = $1::uuid AND u.id = $2::uuid
	`, challengeID, userID).Scan(&manual, &prizeType, &currency, &prizeMinor, &wrMult, &maxBetPrize,
		&withdrawPol, &fsRounds, &fsGame, &fsBetMinor, &gameIDs, &selfEx)
	if err != nil {
		return err
	}
	if manual && !forceDespiteManualReview {
		return nil
	}
	if selfEx.Valid && selfEx.Time.After(time.Now()) {
		return errors.New("user self-excluded")
	}

	var awardedAt sql.NullTime
	if err := pool.QueryRow(ctx, `SELECT prize_awarded_at FROM challenge_entries WHERE id = $1::uuid`, entryID).Scan(&awardedAt); err != nil {
		return err
	}
	if awardedAt.Valid {
		return nil
	}

	ptype := strings.TrimSpace(strings.ToLower(prizeType))
	ccy := strings.TrimSpace(currency)
	if ccy == "" {
		ccy = "USDT"
	}

	var chTitle, chSlug string
	_ = pool.QueryRow(ctx, `SELECT title, COALESCE(slug, '') FROM challenges WHERE id = $1::uuid`, challengeID).Scan(&chTitle, &chSlug)
	idem := fmt.Sprintf("challenge:prize:%s:%s", challengeID, entryID)

	switch ptype {
	case "pool":
		return fmt.Errorf("challenge pool prizes are not automated")

	case "bonus":
		if !prizeMinor.Valid || prizeMinor.Int64 <= 0 {
			return fmt.Errorf("challenge bonus prize missing amount")
		}
		if wrMult < 1 {
			return fmt.Errorf("challenge bonus prize requires prize_wagering_multiplier >= 1")
		}
		wrReq := prizeMinor.Int64 * int64(wrMult)
		withdraw := "block"
		if withdrawPol.Valid && strings.TrimSpace(withdrawPol.String) != "" {
			withdraw = strings.TrimSpace(withdrawPol.String)
		}
		_, err := bonus.GrantChallengeBonusLocked(ctx, pool, bonus.ChallengeGrantArgs{
			UserID:                  userID,
			ChallengeEntryID:        entryID,
			ChallengeID:             challengeID,
			ChallengeTitle:          chTitle,
			IdempotencyKey:          idem,
			GrantAmountMinor:        prizeMinor.Int64,
			Currency:                ccy,
			WRRequiredMinor:         wrReq,
			MaxBetMinor:             maxBetPrize,
			WithdrawPolicy:          withdraw,
			AllowedGameIDs:          gameIDs,
			PrizeWageringMultiplier: wrMult,
		})
		if err != nil {
			return err
		}
		var instCount int
		if err := pool.QueryRow(ctx, `
			SELECT COUNT(*)::int FROM user_bonus_instances WHERE challenge_entry_id = $1::uuid
		`, entryID).Scan(&instCount); err != nil {
			return err
		}
		if instCount == 0 {
			return nil
		}
		_, err = pool.Exec(ctx, `
			UPDATE challenge_entries SET prize_awarded_minor = $2, prize_awarded_at = now(), updated_at = now()
			WHERE id = $1::uuid AND prize_awarded_at IS NULL
		`, entryID, prizeMinor.Int64)
		return err

	case "free_spins":
		if !fsRounds.Valid || fsRounds.Int64 <= 0 {
			return fmt.Errorf("challenge free_spin prize requires prize_free_spins > 0")
		}
		g := ""
		if fsGame.Valid {
			g = strings.TrimSpace(fsGame.String)
		}
		if g == "" {
			return fmt.Errorf("challenge free_spin prize requires prize_free_spin_game_id")
		}
		bet := fsBetMinor
		if bet <= 0 {
			bet = 1
		}
		var bog int32
		err := pool.QueryRow(ctx, `
			SELECT COALESCE(bog_game_id, 0) FROM games WHERE id = $1 OR id_hash = $1 LIMIT 1
		`, g).Scan(&bog)
		if errors.Is(err, pgx.ErrNoRows) || bog <= 0 {
			return fmt.Errorf("challenge free_spin game %q missing Blue Ocean id", g)
		}
		if err != nil {
			return err
		}
		meta := map[string]any{
			"challenge_id":       challengeID,
			"challenge_entry_id": entryID,
			"challenge_title":    chTitle,
			"challenge_slug":     chSlug,
			"prize_type":         "free_spins",
			"source":             "challenge",
		}
		if _, _, err := bonus.InsertFreeSpinGrantWithMetadata(ctx, pool, userID, nil, idem, g, int(fsRounds.Int64), bet, meta); err != nil {
			return err
		}
		_, err = pool.Exec(ctx, `
			UPDATE challenge_entries SET prize_awarded_minor = COALESCE(prize_awarded_minor, 0), prize_awarded_at = now(), updated_at = now()
			WHERE id = $1::uuid AND prize_awarded_at IS NULL
		`, entryID)
		return err

	case "cash":
		if !prizeMinor.Valid || prizeMinor.Int64 <= 0 {
			return nil
		}
		meta := map[string]any{
			"challenge_id":    challengeID,
			"entry_id":        entryID,
			"challenge_title": chTitle,
			"challenge_slug":  chSlug,
			"prize_type":      prizeType,
			"prize_amount_minor": prizeMinor.Int64,
		}
		_, err = ledger.ApplyCredit(ctx, pool, userID, ccy, ledger.EntryTypeChallengePrize, idem, prizeMinor.Int64, meta)
		if err != nil {
			return err
		}
		_, err = pool.Exec(ctx, `
			UPDATE challenge_entries SET prize_awarded_minor = $2, prize_awarded_at = now(), updated_at = now()
			WHERE id = $1::uuid
		`, entryID, prizeMinor.Int64)
		return err

	default:
		return fmt.Errorf("unknown prize_type %q", prizeType)
	}
}
