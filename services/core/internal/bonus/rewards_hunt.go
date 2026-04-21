package bonus

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HuntStatus for hub JSON.
type HuntStatus struct {
	WagerAccruedMinor       int64   `json:"wager_accrued_minor"`
	NextThresholdWagerMinor *int64  `json:"next_threshold_wager_minor,omitempty"`
	NextRewardMinor         *int64  `json:"next_reward_minor,omitempty"`
	LastThresholdIndex      int     `json:"last_threshold_index"`
}

func dayBoundsUTC(d time.Time) (start, end time.Time) {
	day := time.Date(d.UTC().Year(), d.UTC().Month(), d.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return day, day.Add(24 * time.Hour)
}

// SumCashGameDebitForDay returns total cash-pocket wager (abs debit) for UTC day.
func SumCashGameDebitForDay(ctx context.Context, pool *pgxpool.Pool, userID string, day time.Time) (int64, error) {
	start, end := dayBoundsUTC(day)
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ABS(amount_minor)), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type = 'game.debit' AND pocket = 'cash'
		  AND created_at >= $2 AND created_at < $3
	`, userID, start, end).Scan(&sum)
	return sum, err
}

// UpsertHuntProgress sets wager accrued for the day from ledger (source of truth).
func UpsertHuntProgress(ctx context.Context, pool *pgxpool.Pool, userID string, programID int64, day time.Time, wager int64) error {
	ds := UTCDate(day)
	_, err := pool.Exec(ctx, `
		INSERT INTO player_hunt_progress (user_id, reward_program_id, hunt_date, wager_accrued_minor, last_threshold_index, updated_at)
		VALUES ($1::uuid, $2, $3::date, $4, -1, now())
		ON CONFLICT (user_id, reward_program_id, hunt_date) DO UPDATE SET
			wager_accrued_minor = EXCLUDED.wager_accrued_minor,
			updated_at = now()
	`, userID, programID, ds, wager)
	return err
}

// GetHuntStatus returns progress for hub (does not grant).
func GetHuntStatus(ctx context.Context, pool *pgxpool.Pool, userID string, day time.Time) (*HuntStatus, error) {
	k := RewardKindDailyHunt
	programs, err := loadRewardPrograms(ctx, pool, &k)
	if err != nil {
		return nil, err
	}
	if len(programs) == 0 {
		return &HuntStatus{}, nil
	}
	p := programs[0]
	cfg, err := parseHuntConfig(p.Config)
	if err != nil {
		return nil, err
	}
	wager, err := SumCashGameDebitForDay(ctx, pool, userID, day)
	if err != nil {
		return nil, err
	}
	var lastIdx int = -1
	ds := UTCDate(day)
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(last_threshold_index, -1) FROM player_hunt_progress
		WHERE user_id = $1::uuid AND reward_program_id = $2 AND hunt_date = $3::date
	`, userID, p.ID, ds).Scan(&lastIdx)
	if err == pgx.ErrNoRows {
		lastIdx = -1
	} else if err != nil {
		return nil, err
	}

	st := &HuntStatus{
		WagerAccruedMinor:  wager,
		LastThresholdIndex: lastIdx,
	}
	nextI := lastIdx + 1
	if nextI >= 0 && nextI < len(cfg.ThresholdsWagerMinor) && nextI < len(cfg.AmountsMinor) {
		t := cfg.ThresholdsWagerMinor[nextI]
		a := cfg.AmountsMinor[nextI]
		st.NextThresholdWagerMinor = &t
		st.NextRewardMinor = &a
	}
	return st, nil
}

// AdvanceHuntGrants applies milestone grants for one user/day/program (idempotent).
func AdvanceHuntGrants(ctx context.Context, pool *pgxpool.Pool, userID string, p RewardProgram, day time.Time, currency string) error {
	cfg, err := parseHuntConfig(p.Config)
	if err != nil {
		return err
	}
	if len(cfg.ThresholdsWagerMinor) == 0 || len(cfg.AmountsMinor) != len(cfg.ThresholdsWagerMinor) {
		return nil
	}
	wager, err := SumCashGameDebitForDay(ctx, pool, userID, day)
	if err != nil {
		return err
	}
	if err := UpsertHuntProgress(ctx, pool, userID, p.ID, day, wager); err != nil {
		return err
	}

	ds := UTCDate(day)
	var lastIdx int = -1
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(last_threshold_index, -1) FROM player_hunt_progress
		WHERE user_id = $1::uuid AND reward_program_id = $2 AND hunt_date = $3::date
	`, userID, p.ID, ds).Scan(&lastIdx)
	if err == pgx.ErrNoRows {
		lastIdx = -1
	} else if err != nil {
		return err
	}

	ccy := currency
	if ccy == "" {
		ccy = "USDT"
	}

	next := lastIdx + 1
	for next < len(cfg.ThresholdsWagerMinor) && wager >= cfg.ThresholdsWagerMinor[next] {
		amt := cfg.AmountsMinor[next]
		if amt <= 0 {
			next++
			continue
		}
		idem := fmt.Sprintf("bonus:hunt:%d:%s:%s:%d", p.ID, userID, ds, next)
		inserted, err := GrantFromPromotionVersion(ctx, pool, GrantArgs{
			UserID:             userID,
			PromotionVersionID: p.PromotionVersionID,
			IdempotencyKey:     idem,
			GrantAmountMinor:   amt,
			Currency:           ccy,
			DepositAmountMinor: 0,
		})
		if err != nil {
			return err
		}
		if !inserted {
			// active WR blocks further hunt grants this pass
			break
		}
		lastIdx = next
		next++
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO player_hunt_progress (user_id, reward_program_id, hunt_date, wager_accrued_minor, last_threshold_index, updated_at)
		VALUES ($1::uuid, $2, $3::date, $4, $5, now())
		ON CONFLICT (user_id, reward_program_id, hunt_date) DO UPDATE SET
			wager_accrued_minor = EXCLUDED.wager_accrued_minor,
			last_threshold_index = EXCLUDED.last_threshold_index,
			updated_at = now()
	`, userID, p.ID, ds, wager, lastIdx)
	return err
}

// ProcessHuntForRecentPlayers runs hunt milestone grants for users active today (UTC).
func ProcessHuntForRecentPlayers(ctx context.Context, pool *pgxpool.Pool, limit int) (int, error) {
	if limit <= 0 {
		limit = 500
	}
	k := RewardKindDailyHunt
	programs, err := loadRewardPrograms(ctx, pool, &k)
	if err != nil || len(programs) == 0 {
		return 0, err
	}
	p := programs[0]
	day := time.Now().UTC()
	start, end := dayBoundsUTC(day)

	rows, err := pool.Query(ctx, `
		SELECT DISTINCT le.user_id::text
		FROM ledger_entries le
		WHERE le.entry_type = 'game.debit' AND le.pocket = 'cash'
		  AND le.created_at >= $1 AND le.created_at < $2
		LIMIT $3
	`, start, end, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			continue
		}
		if err := AdvanceHuntGrants(ctx, pool, uid, p, day, "USDT"); err != nil {
			continue
		}
		n++
	}
	return n, nil
}
