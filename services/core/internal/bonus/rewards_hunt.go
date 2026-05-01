package bonus

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HuntStatus for hub JSON.
type HuntStatus struct {
	WagerAccruedMinor       int64   `json:"wager_accrued_minor"`
	NextThresholdWagerMinor *int64  `json:"next_threshold_wager_minor,omitempty"`
	NextRewardMinor         *int64  `json:"next_reward_minor,omitempty"`
	LastThresholdIndex      int     `json:"last_threshold_index"`
	LockedReason            *string `json:"locked_reason,omitempty"`
	EffectiveTierID         *int    `json:"effective_tier_id,omitempty"`
}

var ErrHuntNothingToClaim = errors.New("rewards: no hunt reward claimable")

func dayBoundsUTC(d time.Time) (start, end time.Time) {
	day := time.Date(d.UTC().Year(), d.UTC().Month(), d.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return day, day.Add(24 * time.Hour)
}

// SumCashGameDebitForDay returns successful cash-pocket stake for the UTC day
// (debits minus rollbacks, floored at zero).
func SumCashGameDebitForDay(ctx context.Context, pool *pgxpool.Pool, userID string, day time.Time) (int64, error) {
	start, end := dayBoundsUTC(day)
	return ledger.SumSuccessfulCashStakeForWindow(ctx, pool, userID, start, end)
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

	tierID, tierSort, hasRow := LoadPlayerVIPTierForHunt(ctx, pool, userID)
	okGate, why := HuntParticipationGate(cfg, tierSort, hasRow && tierID != nil)
	if !HuntTierEnabled(cfg, tierID) {
		locked := "hunt_disabled_for_tier"
		return &HuntStatus{
			WagerAccruedMinor: 0,
			LastThresholdIndex: lastIdx,
			LockedReason:      &locked,
			EffectiveTierID:   tierID,
		}, nil
	}
	thr, amtArr := EffectiveHuntCurve(cfg, tierID)
	boost := EffectiveHuntXPBoost(cfg, tierID)
	boostedWager := int64(float64(wager) * boost)

	st := &HuntStatus{
		WagerAccruedMinor:  boostedWager,
		LastThresholdIndex: lastIdx,
	}
	if tierID != nil {
		tid := *tierID
		st.EffectiveTierID = &tid
	}
	if !okGate {
		reason := why
		st.LockedReason = &reason
		return st, nil
	}

	nextI := lastIdx + 1
	if nextI >= 0 && nextI < len(thr) && nextI < len(amtArr) {
		t := thr[nextI]
		a := amtArr[nextI]
		st.NextThresholdWagerMinor = &t
		st.NextRewardMinor = &a
	}
	return st, nil
}

func nextClaimableHuntMilestoneIndex(thresholds []int64, lastThresholdIndex int, boostedWager int64) (int, bool) {
	next := lastThresholdIndex + 1
	if next < 0 || next >= len(thresholds) {
		return -1, false
	}
	return next, boostedWager >= thresholds[next]
}

// ClaimNextHuntRewardCash claims one eligible daily-hunt milestone as cash.
func ClaimNextHuntRewardCash(ctx context.Context, pool *pgxpool.Pool, userID string, day time.Time, currency string) (int64, error) {
	k := RewardKindDailyHunt
	programs, err := loadRewardPrograms(ctx, pool, &k)
	if err != nil || len(programs) == 0 {
		return 0, ErrHuntNothingToClaim
	}
	p := programs[0]
	cfg, err := parseHuntConfig(p.Config)
	if err != nil {
		return 0, err
	}
	tierID, tierSort, hasRow := LoadPlayerVIPTierForHunt(ctx, pool, userID)
	okGate, _ := HuntParticipationGate(cfg, tierSort, hasRow && tierID != nil)
	if !okGate || !HuntTierEnabled(cfg, tierID) {
		return 0, ErrHuntNothingToClaim
	}
	thr, amtArr := EffectiveHuntCurve(cfg, tierID)
	if len(thr) == 0 || len(amtArr) != len(thr) {
		return 0, ErrHuntNothingToClaim
	}
	boost := EffectiveHuntXPBoost(cfg, tierID)
	wager, err := SumCashGameDebitForDay(ctx, pool, userID, day)
	if err != nil {
		return 0, err
	}
	boostedWager := int64(float64(wager) * boost)
	ds := UTCDate(day)
	lastIdx := -1
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(last_threshold_index, -1) FROM player_hunt_progress
		WHERE user_id = $1::uuid AND reward_program_id = $2 AND hunt_date = $3::date
	`, userID, p.ID, ds).Scan(&lastIdx)
	if err == pgx.ErrNoRows {
		lastIdx = -1
	} else if err != nil {
		return 0, err
	}
	nextIdx, claimable := nextClaimableHuntMilestoneIndex(thr, lastIdx, boostedWager)
	if !claimable || nextIdx < 0 {
		return 0, ErrHuntNothingToClaim
	}
	amt := amtArr[nextIdx]
	if amt <= 0 {
		return 0, ErrHuntNothingToClaim
	}
	ccy := currency
	if ccy == "" {
		ccy = "USDT"
	}
	idem := fmt.Sprintf("reward:hunt:cash:%d:%s:%s:%d", p.ID, userID, ds, nextIdx)
	inserted, err := PayoutAndCreditCash(ctx, pool, userID, ccy, "promo.daily_hunt_cash", idem, amt, map[string]any{
		"reward_program_id": p.ID,
		"milestone_index":   nextIdx,
		"hunt_date":         ds,
	})
	if err != nil {
		return 0, err
	}
	if !inserted {
		return 0, nil
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO player_hunt_progress (user_id, reward_program_id, hunt_date, wager_accrued_minor, last_threshold_index, updated_at)
		VALUES ($1::uuid, $2, $3::date, $4, $5, now())
		ON CONFLICT (user_id, reward_program_id, hunt_date) DO UPDATE SET
			wager_accrued_minor = EXCLUDED.wager_accrued_minor,
			last_threshold_index = EXCLUDED.last_threshold_index,
			updated_at = now()
	`, userID, p.ID, ds, wager, nextIdx)
	if err != nil {
		return 0, err
	}
	_ = insertNotification(ctx, pool, userID, "vip.hunt_claimed", "Daily hunt cash claimed",
		fmt.Sprintf("You claimed %s from Daily Hunt.", ccy),
		map[string]any{"program_id": p.ID, "milestone_index": nextIdx, "amount_minor": amt})
	return amt, nil
}

// AdvanceHuntGrants applies milestone grants for one user/day/program (idempotent).
func AdvanceHuntGrants(ctx context.Context, pool *pgxpool.Pool, userID string, p RewardProgram, day time.Time, _ string) error {
	cfg, err := parseHuntConfig(p.Config)
	if err != nil {
		return err
	}
	tierID, tierSort, hasRow := LoadPlayerVIPTierForHunt(ctx, pool, userID)
	okGate, _ := HuntParticipationGate(cfg, tierSort, hasRow && tierID != nil)
	if !HuntTierEnabled(cfg, tierID) {
		ds := UTCDate(day)
		_, err = pool.Exec(ctx, `
			INSERT INTO player_hunt_progress (user_id, reward_program_id, hunt_date, wager_accrued_minor, last_threshold_index, updated_at)
			VALUES ($1::uuid, $2, $3::date, $4, $5, now())
			ON CONFLICT (user_id, reward_program_id, hunt_date) DO UPDATE SET
				wager_accrued_minor = EXCLUDED.wager_accrued_minor,
				updated_at = now()
		`, userID, p.ID, ds, 0, -1)
		return err
	}
	thr, amtArr := EffectiveHuntCurve(cfg, tierID)
	if len(thr) == 0 || len(amtArr) != len(thr) {
		return nil
	}
	wager, err := SumCashGameDebitForDay(ctx, pool, userID, day)
	if err != nil {
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

	if !okGate {
		_, err = pool.Exec(ctx, `
			INSERT INTO player_hunt_progress (user_id, reward_program_id, hunt_date, wager_accrued_minor, last_threshold_index, updated_at)
			VALUES ($1::uuid, $2, $3::date, $4, $5, now())
			ON CONFLICT (user_id, reward_program_id, hunt_date) DO UPDATE SET
				wager_accrued_minor = EXCLUDED.wager_accrued_minor,
				updated_at = now()
		`, userID, p.ID, ds, wager, lastIdx)
		return err
	}

	// Hunt payouts are player-claimed as cash via ClaimNextHuntRewardCash.
	// This worker path only refreshes accrued wager progress.

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
		WHERE le.pocket = 'cash'
		  AND le.entry_type IN ('game.debit', 'game.rollback')
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
