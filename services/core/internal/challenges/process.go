package challenges

import (
	"context"
	"encoding/json"
	"log"
	"math/big"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func gameMatches(gameIDs []string, gameID string) bool {
	if len(gameIDs) == 0 {
		return true
	}
	g := strings.TrimSpace(gameID)
	if g == "" {
		return false
	}
	for _, id := range gameIDs {
		if strings.TrimSpace(id) == g {
			return true
		}
	}
	return false
}

func multiplierFromStakeWin(stake, win int64) *big.Rat {
	if stake <= 0 {
		return big.NewRat(0, 1)
	}
	return big.NewRat(win, stake)
}

func ratToFloat(r *big.Rat) float64 {
	f, _ := r.Float64()
	return f
}

func ProcessDebit(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, p BODebitPayload) error {
	if cfg != nil && cfg.ChallengeIngestDisabled {
		return nil
	}
	_ = PromoteAllDueScheduledChallenges(ctx, pool)
	ct, err := pool.Exec(ctx, `
		INSERT INTO challenge_round_processing (user_id, remote_id, txn_id, phase)
		VALUES ($1::uuid, $2, $3, 'debit')
		ON CONFLICT DO NOTHING
	`, p.UserID, p.RemoteID, p.TxnID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return nil
	}

	stakeLedger, _, ledgerErr := ResolveBlueOceanRound(ctx, pool, p.UserID, p.RemoteID, p.TxnID)
	if ledgerErr != nil {
		log.Printf("challenges ProcessDebit: ResolveBlueOceanRound: %v", ledgerErr)
	}
	stakeMinor := p.StakeMinor
	if stakeLedger > 0 {
		stakeMinor = stakeLedger
		if p.StakeMinor > 0 && stakeLedger != p.StakeMinor {
			log.Printf("challenges: debit stake mismatch user=%s remote=%s txn=%s ledger=%d callback=%d",
				p.UserID, p.RemoteID, p.TxnID, stakeLedger, p.StakeMinor)
		}
	}

	rows, err := pool.Query(ctx, `
		SELECT ce.id::text, ce.challenge_id::text, c.challenge_type, c.min_bet_amount_minor, c.max_bet_amount_minor,
		       c.target_wager_amount_minor, c.starts_at, c.ends_at, c.game_ids, c.require_claim_for_prize
		FROM challenge_entries ce
		JOIN challenges c ON c.id = ce.challenge_id
		WHERE ce.user_id = $1::uuid AND ce.status = 'active'
		  AND c.status = 'active'
		  AND now() >= c.starts_at AND now() < c.ends_at
	`, p.UserID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var entryID, challengeID string
		var ctype string
		var minBet int64
		var maxBet, targetWager *int64
		var starts, ends time.Time
		var gameIDs []string
		var requireClaim bool
		if err := rows.Scan(&entryID, &challengeID, &ctype, &minBet, &maxBet, &targetWager, &starts, &ends, &gameIDs, &requireClaim); err != nil {
			return err
		}
		if !gameMatches(gameIDs, p.GameID) {
			continue
		}
		if stakeMinor < minBet {
			continue
		}
		if maxBet != nil && *maxBet > 0 && stakeMinor > *maxBet {
			_, _ = pool.Exec(ctx, `
				UPDATE challenge_entries SET
				  flagged_for_review = true,
				  flag_reasons = CASE
				    WHEN flag_reasons IS NULL THEN ARRAY['bet_exceeds_max_threshold']::text[]
				    WHEN NOT ('bet_exceeds_max_threshold' = ANY(flag_reasons)) THEN array_append(flag_reasons, 'bet_exceeds_max_threshold')
				    ELSE flag_reasons END,
				  risk_score = LEAST(100, COALESCE(risk_score, 0) + 25),
				  updated_at = now()
				WHERE id = $1::uuid
			`, entryID)
			continue
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}

		var curWager int64
		err = tx.QueryRow(ctx, `
			SELECT total_wagered_minor FROM challenge_entries WHERE id = $1::uuid FOR UPDATE
		`, entryID).Scan(&curWager)
		if err != nil {
			_ = tx.Rollback(ctx)
			return err
		}

		newWager := curWager + stakeMinor
		shouldComplete := ctype == "wager_volume" && targetWager != nil && *targetWager > 0 && newWager >= *targetWager

		if ctype == "wager_volume" {
			_, err = tx.Exec(ctx, `
				UPDATE challenge_entries SET
				  qualifying_bets = qualifying_bets + 1,
				  total_wagered_minor = $2,
				  progress_value = $2::numeric,
				  updated_at = now()
				WHERE id = $1::uuid AND status = 'active'
			`, entryID, newWager)
		} else {
			_, err = tx.Exec(ctx, `
				UPDATE challenge_entries SET
				  qualifying_bets = qualifying_bets + 1,
				  total_wagered_minor = total_wagered_minor + $2,
				  updated_at = now()
				WHERE id = $1::uuid AND status = 'active'
			`, entryID, stakeMinor)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return err
		}

		if shouldComplete {
			if err := markCompletedTx(ctx, tx, entryID, challengeID, p.UserID, p.RemoteID+":"+p.TxnID, nil); err != nil {
				_ = tx.Rollback(ctx)
				return err
			}
		}

		if err := tx.Commit(ctx); err != nil {
			return err
		}
		if shouldComplete {
			if !requireClaim {
				if err := AwardPrizeIfNeeded(ctx, pool, entryID, challengeID, p.UserID, false); err != nil {
					log.Printf("challenges: award after wager_volume: %v", err)
				}
			}
		}
	}
	return rows.Err()
}

// ProcessCredit inserts bet events and advances multiplier / win_streak / race.
func ProcessCredit(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, p BOCreditPayload) error {
	if cfg != nil && cfg.ChallengeIngestDisabled {
		return nil
	}
	_ = PromoteAllDueScheduledChallenges(ctx, pool)
	ct, err := pool.Exec(ctx, `
		INSERT INTO challenge_round_processing (user_id, remote_id, txn_id, phase)
		VALUES ($1::uuid, $2, $3, 'credit')
		ON CONFLICT DO NOTHING
	`, p.UserID, p.RemoteID, p.TxnID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return nil
	}

	stakeLedger, winLedger, err := ResolveBlueOceanRound(ctx, pool, p.UserID, p.RemoteID, p.TxnID)
	if err != nil {
		return err
	}
	win := winLedger
	if p.WinMinor > win {
		win = p.WinMinor
	}
	stake := stakeLedger
	multRat := multiplierFromStakeWin(stake, win)
	multF := ratToFloat(multRat)
	rr := roundResult(win)
	providerBetID := p.RemoteID + ":" + p.TxnID
	gameID := strings.TrimSpace(p.GameID)

	rows, err := pool.Query(ctx, `
		SELECT ce.id::text, ce.challenge_id::text, c.challenge_type, c.min_bet_amount_minor, c.max_bet_amount_minor,
		       c.target_multiplier, c.target_win_streak, c.starts_at, c.ends_at, c.game_ids,
		       COALESCE(ce.best_multiplier, 0)::float8, ce.current_streak, c.require_claim_for_prize
		FROM challenge_entries ce
		JOIN challenges c ON c.id = ce.challenge_id
		WHERE ce.user_id = $1::uuid AND ce.status = 'active'
		  AND c.status = 'active'
		  AND now() >= c.starts_at AND now() < c.ends_at
	`, p.UserID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var entryID, challengeID string
		var ctype string
		var minBet int64
		var maxBet *int64
		var tgtMult *float64
		var tgtStreak *int
		var starts, ends time.Time
		var gameIDs []string
		var best float64
		var curStreak int
		var requireClaim bool
		if err := rows.Scan(&entryID, &challengeID, &ctype, &minBet, &maxBet, &tgtMult, &tgtStreak, &starts, &ends, &gameIDs, &best, &curStreak, &requireClaim); err != nil {
			return err
		}
		if !gameMatches(gameIDs, gameID) {
			continue
		}
		if stake < minBet {
			continue
		}
		if maxBet != nil && *maxBet > 0 && stake > *maxBet {
			continue
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO challenge_bet_events (
			  entry_id, challenge_id, user_id, provider_bet_id, game_id, bet_amount_minor, win_amount_minor,
			  multiplier, round_result, settled_at
			) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, now())
			ON CONFLICT (entry_id, provider_bet_id) DO NOTHING
		`, entryID, challengeID, p.UserID, providerBetID, strings.TrimSpace(gameID), stake, win, multF, rr)
		if err != nil {
			_ = tx.Rollback(ctx)
			return err
		}

		var completed bool
		switch ctype {
		case "multiplier":
			newBest := best
			if multF > newBest {
				newBest = multF
			}
			done := tgtMult != nil && newBest >= *tgtMult
			_, err = tx.Exec(ctx, `
				UPDATE challenge_entries SET
				  best_multiplier = $2,
				  progress_value = $2,
				  updated_at = now()
				WHERE id = $1::uuid AND status = 'active'
			`, entryID, newBest)
			if err != nil {
				_ = tx.Rollback(ctx)
				return err
			}
			if done {
				wm := multF
				if err := markCompletedTx(ctx, tx, entryID, challengeID, p.UserID, providerBetID, &wm); err != nil {
					_ = tx.Rollback(ctx)
					return err
				}
				completed = true
			}
		case "win_streak":
			ns := curStreak
			if rr == "win" {
				ns = curStreak + 1
			} else {
				ns = 0
			}
			done := tgtStreak != nil && ns >= *tgtStreak
			_, err = tx.Exec(ctx, `
				UPDATE challenge_entries SET current_streak = $2, progress_value = $2::numeric, updated_at = now()
				WHERE id = $1::uuid AND status = 'active'
			`, entryID, ns)
			if err != nil {
				_ = tx.Rollback(ctx)
				return err
			}
			if done {
				m := multF
				if err := markCompletedTx(ctx, tx, entryID, challengeID, p.UserID, providerBetID, &m); err != nil {
					_ = tx.Rollback(ctx)
					return err
				}
				completed = true
			}
		case "race":
			_, err = tx.Exec(ctx, `
				UPDATE challenge_entries SET
				  best_multiplier = GREATEST(COALESCE(best_multiplier, 0), $2::numeric),
				  progress_value = GREATEST(COALESCE(progress_value, 0), $2::numeric),
				  updated_at = now()
				WHERE id = $1::uuid AND status = 'active'
			`, entryID, multF)
			if err != nil {
				_ = tx.Rollback(ctx)
				return err
			}
		default:
			// wager_volume: progress on debit only
		}

		if err := tx.Commit(ctx); err != nil {
			return err
		}
		if completed && !requireClaim {
			if err := AwardPrizeIfNeeded(ctx, pool, entryID, challengeID, p.UserID, false); err != nil {
				log.Printf("challenges: award after credit: %v", err)
			}
		}
	}
	return rows.Err()
}

func markCompletedTx(ctx context.Context, tx pgx.Tx, entryID, challengeID, userID, providerBetID string, winningMult *float64) error {
	var winners, maxWin int
	err := tx.QueryRow(ctx, `
		SELECT winners_count, max_winners FROM challenges WHERE id = $1::uuid FOR UPDATE
	`, challengeID).Scan(&winners, &maxWin)
	if err != nil {
		return err
	}
	if winners >= maxWin {
		return nil
	}
	_, err = tx.Exec(ctx, `
		UPDATE challenge_entries SET
		  status = 'completed',
		  completed_at = now(),
		  winning_bet_id = $2,
		  winning_multiplier = $3,
		  updated_at = now()
		WHERE id = $1::uuid AND status = 'active'
	`, entryID, providerBetID, winningMult)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE challenges SET winners_count = winners_count + 1, updated_at = now() WHERE id = $1::uuid
	`, challengeID)
	if err != nil {
		return err
	}
	meta := map[string]any{"challenge_id": challengeID, "entry_id": entryID, "user_id": userID}
	detail, _ := json.Marshal(meta)
	_, err = tx.Exec(ctx, `
		INSERT INTO challenge_audit_log (challenge_id, entry_id, actor_type, action, details)
		VALUES ($1::uuid, $2::uuid, 'system', 'entry_completed', $3::jsonb)
	`, challengeID, entryID, detail)
	return err
}
