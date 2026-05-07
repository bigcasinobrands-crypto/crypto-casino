package bonus

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CalendarDay is one day in GET /v1/rewards/calendar.
type CalendarDay struct {
	Date        string `json:"date"`
	State       string `json:"state"` // claimable | locked | claimed | blocked
	AmountMinor int64  `json:"amount_minor"`
	UnlockAt    *string `json:"unlock_at,omitempty"` // RFC3339 UTC, start of that calendar day
	// BlockReason is set when State is "blocked" (e.g. active_wagering).
	BlockReason string `json:"block_reason,omitempty"`
	// PayoutKind describes what the player receives when claiming; daily_fixed credits a promo (bonus), not cash wallet.
	PayoutKind string `json:"payout_kind,omitempty"` // bonus
}

var (
	// ErrDailyNotClaimable is returned when the date cannot be claimed.
	ErrDailyNotClaimable = errors.New("rewards: day not claimable")
	// ErrDailyBlockedByWagering when user must finish an active bonus first.
	ErrDailyBlockedByWagering = errors.New("rewards: blocked by active bonus wagering")
	// ErrDailyNoProgram when no daily_fixed program is configured.
	ErrDailyNoProgram = errors.New("rewards: no daily program")
	// ErrDailyMinWagerNotMet when min_qualifying_wager_minor is not satisfied for that UTC day.
	ErrDailyMinWagerNotMet = errors.New("rewards: qualifying wager not met for daily claim")
)

func calendarDateRange(days int, now time.Time) (from, to time.Time) {
	if days < 1 {
		days = 7
	}
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	half := (days - 1) / 2
	from = today.AddDate(0, 0, -half)
	to = from.AddDate(0, 0, days-1)
	return from, to
}

// BuildRewardsCalendar builds day cards for the authenticated user.
func BuildRewardsCalendar(ctx context.Context, pool *pgxpool.Pool, userID string, days int, now time.Time) ([]CalendarDay, error) {
	k := RewardKindDailyFixed
	programs, err := loadRewardPrograms(ctx, pool, &k)
	if err != nil {
		return nil, err
	}
	if len(programs) == 0 {
		return []CalendarDay{}, nil
	}
	p := programs[0]
	cfg, err := parseDailyConfig(p.Config)
	if err != nil {
		return nil, err
	}
	amt := cfg.AmountMinor
	if amt < 0 {
		amt = 0
	}

	from, to := calendarDateRange(days, now)
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)

	rows, err := pool.Query(ctx, `
		SELECT claim_date::text FROM player_reward_claims
		WHERE user_id = $1::uuid AND reward_program_id = $2
		  AND claim_date >= $3::date AND claim_date <= $4::date AND status = 'completed'
	`, userID, p.ID, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	claimed := map[string]bool{}
	for rows.Next() {
		var ds string
		if err := rows.Scan(&ds); err != nil {
			continue
		}
		claimed[ds] = true
	}

	activeWR, err := CountActiveIncompleteWagering(ctx, pool, userID)
	if err != nil {
		return nil, err
	}

	var out []CalendarDay
	const payoutBonus = "bonus"
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		ds := d.Format("2006-01-02")
		unlock := d.UTC().Format(time.RFC3339)
		if claimed[ds] {
			out = append(out, CalendarDay{Date: ds, State: "claimed", AmountMinor: amt, UnlockAt: &unlock, PayoutKind: payoutBonus})
			continue
		}
		if d.After(today) {
			out = append(out, CalendarDay{Date: ds, State: "locked", AmountMinor: amt, UnlockAt: &unlock, PayoutKind: payoutBonus})
			continue
		}
		// today or past: claimable if past window allowed (last 7 days including today)
		minDate := today.AddDate(0, 0, -6)
		if d.Before(minDate) {
			out = append(out, CalendarDay{Date: ds, State: "locked", AmountMinor: amt, UnlockAt: &unlock, PayoutKind: payoutBonus})
			continue
		}
		if activeWR > 0 {
			out = append(out, CalendarDay{
				Date:        ds,
				State:       "blocked",
				AmountMinor: amt,
				UnlockAt:    &unlock,
				BlockReason: "active_wagering",
				PayoutKind:  payoutBonus,
			})
			continue
		}
		if cfg.MinQualifyingWagerMinor > 0 {
			wagerDay, err := SumCashGameDebitForDay(ctx, pool, userID, d)
			if err != nil {
				return nil, err
			}
			if wagerDay < cfg.MinQualifyingWagerMinor {
				out = append(out, CalendarDay{
					Date:        ds,
					State:       "blocked",
					AmountMinor: amt,
					UnlockAt:    &unlock,
					BlockReason: "min_daily_wager",
					PayoutKind:  payoutBonus,
				})
				continue
			}
		}
		out = append(out, CalendarDay{Date: ds, State: "claimable", AmountMinor: amt, UnlockAt: &unlock, PayoutKind: payoutBonus})
	}
	return out, nil
}

// ClaimDailyReward grants the daily_fixed program for claimDate (YYYY-MM-DD UTC).
func ClaimDailyReward(ctx context.Context, pool *pgxpool.Pool, userID, claimDate string, currency string) error {
	k := RewardKindDailyFixed
	programs, err := loadRewardPrograms(ctx, pool, &k)
	if err != nil {
		return err
	}
	if len(programs) == 0 {
		return ErrDailyNoProgram
	}
	p := programs[0]
	d, err := parseUTCDate(claimDate)
	if err != nil {
		return fmt.Errorf("%w: bad date", ErrDailyNotClaimable)
	}
	day := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if day.After(today) {
		return ErrDailyNotClaimable
	}
	minDate := today.AddDate(0, 0, -6)
	if day.Before(minDate) {
		return ErrDailyNotClaimable
	}

	cfg, err := parseDailyConfig(p.Config)
	if err != nil {
		return err
	}
	if cfg.AmountMinor <= 0 {
		return fmt.Errorf("%w: zero amount", ErrDailyNotClaimable)
	}

	nWR, err := CountActiveIncompleteWagering(ctx, pool, userID)
	if err != nil {
		return err
	}
	if nWR > 0 {
		return ErrDailyBlockedByWagering
	}

	if cfg.MinQualifyingWagerMinor > 0 {
		wagerDay, err := SumCashGameDebitForDay(ctx, pool, userID, day)
		if err != nil {
			return err
		}
		if wagerDay < cfg.MinQualifyingWagerMinor {
			return ErrDailyMinWagerNotMet
		}
	}

	ccy := currency
	if ccy == "" {
		ccy = "USDT"
	}
	idem := fmt.Sprintf("bonus:reward:daily:%d:%s:%s", p.ID, userID, claimDate)

	// Atomically reserve the daily slot before we touch the bonus ledger.
	// We insert the player_reward_claims row in 'pending' state; if a row already
	// exists for (user, program, date), the ON CONFLICT path returns the existing
	// status. This eliminates the previous race where:
	//   - GrantFromPromotionVersion succeeded
	//   - the followup INSERT into player_reward_claims failed (network blip / shutdown)
	//   - a retry would re-enter ClaimDailyReward, see no completed claim row,
	//     and re-call grant. Today the inserted=false guard makes that a UX bug
	//     ("not claimable" on retry) but the pending-row approach makes it a real
	//     resume: the grant is re-invoked under the same idempotency key (a no-op
	//     in the ledger) and the row is finalized to 'completed'.
	var existingStatus string
	if err := pool.QueryRow(ctx, `
		INSERT INTO player_reward_claims (user_id, reward_program_id, claim_date, amount_minor, status, idempotency_key)
		VALUES ($1::uuid, $2, $3::date, $4, 'pending', $5)
		ON CONFLICT (user_id, reward_program_id, claim_date) DO UPDATE
		  SET claim_date = EXCLUDED.claim_date
		RETURNING status
	`, userID, p.ID, claimDate, cfg.AmountMinor, idem).Scan(&existingStatus); err != nil {
		return err
	}
	if existingStatus == "completed" {
		return nil
	}

	inserted, err := GrantFromPromotionVersion(ctx, pool, GrantArgs{
		UserID:             userID,
		PromotionVersionID: p.PromotionVersionID,
		IdempotencyKey:     idem,
		GrantAmountMinor:   cfg.AmountMinor,
		Currency:           ccy,
		DepositAmountMinor: 0,
	})
	if err != nil {
		// Leave the pending row in place. A future retry will resume the grant
		// under the same deterministic idempotency key and the ledger remains
		// the source of truth — we cannot double-credit.
		return err
	}
	if !inserted {
		// inserted=false from GrantFromPromotionVersion can mean either
		// (a) the idempotency key already produced a grant on a prior call,
		//     in which case we should finalize the pending claim, OR
		// (b) the bonus engine refused to grant (e.g. risk gate, dedup, max
		//     active bonuses). We disambiguate by checking whether a
		//     user_bonus_instances row exists for this idempotency key.
		var grantExists bool
		_ = pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM user_bonus_instances
				WHERE idempotency_key = $1
			)
		`, idem).Scan(&grantExists)
		if !grantExists {
			// True risk-gate refusal: drop the pending row so the player can
			// retry later when conditions change (e.g. min wager satisfied).
			_, _ = pool.Exec(ctx, `
				DELETE FROM player_reward_claims
				WHERE user_id = $1::uuid AND reward_program_id = $2 AND claim_date = $3::date AND status = 'pending'
			`, userID, p.ID, claimDate)
			return ErrDailyNotClaimable
		}
		// fall through and finalize the claim row
	}

	if _, err := pool.Exec(ctx, `
		UPDATE player_reward_claims
		SET status = 'completed'
		WHERE user_id = $1::uuid AND reward_program_id = $2 AND claim_date = $3::date AND status = 'pending'
	`, userID, p.ID, claimDate); err != nil {
		return err
	}
	return nil
}
