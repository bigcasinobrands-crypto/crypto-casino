package wallet

import (
	"context"
	"fmt"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FraudCheckResult describes why a withdrawal was blocked (if at all).
type FraudCheckResult struct {
	Allowed bool
	Reason  string // human-readable; safe to show to the user
}

// RunFraudChecks evaluates configurable limits before allowing a withdrawal.
// Returns Allowed=true when all checks pass.
func RunFraudChecks(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, userID string, amountCents int64) FraudCheckResult {
	if cfg == nil {
		return FraudCheckResult{Allowed: true}
	}

	// 1. Single withdrawal amount limit
	if cfg.WithdrawMaxSingleCents > 0 && amountCents > cfg.WithdrawMaxSingleCents {
		return FraudCheckResult{
			Reason: fmt.Sprintf("Exceeds maximum single withdrawal of $%.2f", float64(cfg.WithdrawMaxSingleCents)/100),
		}
	}

	// 2. Minimum account age
	if cfg.WithdrawMinAccountAgeSec > 0 {
		var createdAt time.Time
		err := pool.QueryRow(ctx, `SELECT created_at FROM players WHERE id = $1::uuid`, userID).Scan(&createdAt)
		if err != nil {
			return FraudCheckResult{Reason: "Could not verify account age"}
		}
		age := time.Since(createdAt)
		minAge := time.Duration(cfg.WithdrawMinAccountAgeSec) * time.Second
		if age < minAge {
			remaining := minAge - age
			hours := int(remaining.Hours())
			if hours < 1 {
				return FraudCheckResult{Reason: fmt.Sprintf("Account must be at least %d minutes old to withdraw", int(minAge.Minutes()))}
			}
			return FraudCheckResult{Reason: fmt.Sprintf("Account too new; withdrawals available in %d hours", hours)}
		}
	}

	// 3. Daily withdrawal count limit
	if cfg.WithdrawDailyCountLimit > 0 {
		var count int
		err := pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM fystack_withdrawals
			WHERE user_id = $1::uuid AND created_at > NOW() - INTERVAL '24 hours'
			AND status NOT IN ('provider_error', 'failed', 'cancelled')
		`, userID).Scan(&count)
		if err == nil && count >= cfg.WithdrawDailyCountLimit {
			return FraudCheckResult{
				Reason: fmt.Sprintf("Daily withdrawal limit reached (%d per 24 hours)", cfg.WithdrawDailyCountLimit),
			}
		}
	}

	// 4. Daily total amount limit
	if cfg.WithdrawDailyLimitCents > 0 {
		var totalToday int64
		err := pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_minor), 0) FROM fystack_withdrawals
			WHERE user_id = $1::uuid AND created_at > NOW() - INTERVAL '24 hours'
			AND status NOT IN ('provider_error', 'failed', 'cancelled')
		`, userID).Scan(&totalToday)
		if err == nil && (totalToday+amountCents) > cfg.WithdrawDailyLimitCents {
			remaining := cfg.WithdrawDailyLimitCents - totalToday
			if remaining <= 0 {
				return FraudCheckResult{
					Reason: fmt.Sprintf("Daily withdrawal limit of $%.2f reached", float64(cfg.WithdrawDailyLimitCents)/100),
				}
			}
			return FraudCheckResult{
				Reason: fmt.Sprintf("Exceeds daily limit; you can withdraw up to $%.2f more today", float64(remaining)/100),
			}
		}
	}

	return FraudCheckResult{Allowed: true}
}
