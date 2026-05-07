package compliance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Responsible-Gambling (RG) limits enforcement helpers.
//
// The persistent store is `player_rg_limits` (migration 00071). One row per
// (user_id, limit_type) is "active" when active_until IS NULL. Limits come in
// three families:
//
//   - Deposit caps: deposit_daily / deposit_weekly / deposit_monthly. Checked
//     at the deposit webhook BEFORE crediting the player. For crypto rails
//     where funds are already received we cannot bounce the deposit, but we
//     can hold it in REVIEW status and raise a reconciliation alert so an
//     operator can decide whether to credit or refund.
//   - Loss caps: loss_daily / loss_weekly / loss_monthly. Computed against
//     the ledger as net cash loss (debits − credits − rollbacks). Checked at
//     game.debit time so a single big bet over the cap is blocked.
//   - Cooling-off: cooling_off_until is a hard self-exclusion window. While
//     active, deposits, withdrawals, and game wagers are all blocked.
//
// All checks are READ-ONLY against the database; they NEVER write. Callers
// that need to record a violation should insert reconciliation_alerts rows
// at the call site so the alert carries the right reference_type/id.

// ErrCoolingOff is returned when the user is inside an active cooling-off window.
var ErrCoolingOff = errors.New("compliance: cooling-off period active")

// ErrDepositLimitExceeded is returned when crediting this deposit would push
// the user past their deposit_{daily,weekly,monthly} cap.
var ErrDepositLimitExceeded = errors.New("compliance: deposit limit exceeded")

// ErrLossLimitExceeded is returned when this stake would push the user past
// their loss_{daily,weekly,monthly} cap.
var ErrLossLimitExceeded = errors.New("compliance: loss limit exceeded")

// LimitWindow returns the start of the rolling window for a given limit_type
// suffix (`daily`, `weekly`, `monthly`). The window is anchored at "now" and
// looks BACKWARDS, which matches what regulators expect ("max £500 deposited
// in the last 24 hours") rather than fixed UTC calendar boundaries.
func LimitWindow(now time.Time, suffix string) time.Time {
	switch suffix {
	case "weekly":
		return now.Add(-7 * 24 * time.Hour)
	case "monthly":
		return now.Add(-30 * 24 * time.Hour)
	default:
		return now.Add(-24 * time.Hour)
	}
}

// activeLimit holds the relevant fields for a single active limit row.
type activeLimit struct {
	LimitType        string
	AmountMinor      *int64
	CoolingOffUntil  *time.Time
	DurationMinutes  *int
}

// loadActiveLimits returns all currently-active RG limit rows for a user.
// "Active" means active_until IS NULL OR active_until > now().
func loadActiveLimits(ctx context.Context, q querier, userID string) ([]activeLimit, error) {
	rows, err := q.Query(ctx, `
		SELECT limit_type, amount_minor, cooling_off_until, duration_minutes
		FROM player_rg_limits
		WHERE user_id = $1::uuid
		  AND (active_until IS NULL OR active_until > now())
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []activeLimit
	for rows.Next() {
		var lim activeLimit
		if err := rows.Scan(&lim.LimitType, &lim.AmountMinor, &lim.CoolingOffUntil, &lim.DurationMinutes); err != nil {
			return nil, err
		}
		out = append(out, lim)
	}
	return out, rows.Err()
}

// querier matches both *pgxpool.Pool and pgx.Tx.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// CheckCoolingOff returns ErrCoolingOff if the user has an active cooling-off
// window. The error is wrapped with the timestamp the player can self-serve
// again so callers can surface a meaningful UI message.
func CheckCoolingOff(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	if pool == nil {
		return nil
	}
	limits, err := loadActiveLimits(ctx, pool, userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, l := range limits {
		if l.LimitType != "cooling_off_until" {
			continue
		}
		if l.CoolingOffUntil != nil && l.CoolingOffUntil.After(now) {
			return fmt.Errorf("%w: until %s", ErrCoolingOff, l.CoolingOffUntil.UTC().Format(time.RFC3339))
		}
	}
	return nil
}

// CheckDepositAllowed enforces deposit caps for a brand-new credit of size
// `incomingMinor`. It MUST be called BEFORE the player ledger credit is
// posted. Returns ErrDepositLimitExceeded with a nested cap descriptor when
// the new deposit would push the rolling sum past one of the caps.
//
// Cooling-off blocks all deposits regardless of amount.
func CheckDepositAllowed(ctx context.Context, pool *pgxpool.Pool, userID, currency string, incomingMinor int64) error {
	if pool == nil || incomingMinor <= 0 {
		return nil
	}
	if err := CheckCoolingOff(ctx, pool, userID); err != nil {
		return err
	}
	limits, err := loadActiveLimits(ctx, pool, userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	ccy := strings.ToUpper(strings.TrimSpace(currency))
	for _, l := range limits {
		if !strings.HasPrefix(l.LimitType, "deposit_") || l.AmountMinor == nil || *l.AmountMinor <= 0 {
			continue
		}
		suffix := strings.TrimPrefix(l.LimitType, "deposit_")
		windowStart := LimitWindow(now, suffix)
		var soFar int64
		err := pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
			WHERE user_id = $1::uuid
			  AND entry_type = 'deposit.credit'
			  AND amount_minor > 0
			  AND ($2 = '' OR currency = $2)
			  AND created_at >= $3
		`, userID, ccy, windowStart).Scan(&soFar)
		if err != nil {
			return err
		}
		if soFar+incomingMinor > *l.AmountMinor {
			return fmt.Errorf("%w: %s cap=%d already=%d incoming=%d",
				ErrDepositLimitExceeded, l.LimitType, *l.AmountMinor, soFar, incomingMinor)
		}
	}
	return nil
}

// CheckWithdrawalAllowed gates outgoing withdrawals on cooling-off. We do not
// block withdrawals on deposit/loss caps because those are about money moving
// IN; a player should always be able to withdraw their own funds (subject to
// pending wagering, which is enforced elsewhere).
func CheckWithdrawalAllowed(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	if pool == nil {
		return nil
	}
	return CheckCoolingOff(ctx, pool, userID)
}

// CheckLossLimit returns ErrLossLimitExceeded if completing a stake of
// `incomingStakeMinor` on the cash pocket would push the player's net cash
// loss past one of their active loss caps. Net loss in this implementation is
//
//	SUM(ABS(game.debit + game.bet + sportsbook.debit))
//	- SUM(game.credit + game.win + sportsbook.credit)
//	- SUM(ABS(game.rollback + sportsbook.rollback))
//
// across the relevant rolling window, plus the incoming stake. The function
// is read-only; callers (BlueOcean / Oddin debit handlers) decide whether to
// reject the bet or just raise an alert.
func CheckLossLimit(ctx context.Context, q querier, userID string, incomingStakeMinor int64) error {
	if q == nil || incomingStakeMinor <= 0 {
		return nil
	}
	limits, err := loadActiveLimits(ctx, q, userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, l := range limits {
		if !strings.HasPrefix(l.LimitType, "loss_") || l.AmountMinor == nil || *l.AmountMinor <= 0 {
			continue
		}
		suffix := strings.TrimPrefix(l.LimitType, "loss_")
		windowStart := LimitWindow(now, suffix)
		var debits, credits, rollbacks int64
		err := q.QueryRow(ctx, `
			SELECT
				COALESCE(SUM(CASE WHEN entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(amount_minor) ELSE 0 END), 0)::bigint,
				COALESCE(SUM(CASE WHEN entry_type IN ('game.credit','game.win','sportsbook.credit') THEN amount_minor ELSE 0 END), 0)::bigint,
				COALESCE(SUM(CASE WHEN entry_type IN ('game.rollback','sportsbook.rollback') THEN ABS(amount_minor) ELSE 0 END), 0)::bigint
			FROM ledger_entries
			WHERE user_id = $1::uuid
			  AND pocket = 'cash'
			  AND entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback','sportsbook.debit','sportsbook.credit','sportsbook.rollback')
			  AND created_at >= $2
		`, userID, windowStart).Scan(&debits, &credits, &rollbacks)
		if err != nil {
			return err
		}
		netLoss := debits - rollbacks - credits
		if netLoss < 0 {
			netLoss = 0
		}
		if netLoss+incomingStakeMinor > *l.AmountMinor {
			return fmt.Errorf("%w: %s cap=%d net_loss=%d incoming=%d",
				ErrLossLimitExceeded, l.LimitType, *l.AmountMinor, netLoss, incomingStakeMinor)
		}
	}
	return nil
}
