package bonus

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func weekBoundsContaining(day time.Time) (start, end time.Time) {
	d := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	for d.Weekday() != time.Monday {
		d = d.AddDate(0, 0, -1)
	}
	start = d
	end = d.AddDate(0, 0, 7)
	return start, end
}

func sumCashGameNetForWindow(ctx context.Context, pool *pgxpool.Pool, userID string, start, end time.Time) (int64, error) {
	var net int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash'
		  AND entry_type IN ('game.debit', 'game.credit')
		  AND created_at >= $2 AND created_at < $3
	`, userID, start, end).Scan(&net)
	return net, err
}

func effectiveRebatePercent(basePct, vipAdd int) int {
	p := basePct + vipAdd
	if p > 100 {
		return 100
	}
	if p < 0 {
		return 0
	}
	return p
}

func sumCashWagerForWindow(ctx context.Context, pool *pgxpool.Pool, userID string, start, end time.Time) (int64, error) {
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ABS(amount_minor)), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND pocket = 'cash' AND entry_type = 'game.debit'
		  AND created_at >= $2 AND created_at < $3
	`, userID, start, end).Scan(&sum)
	return sum, err
}

// ProcessRebateGrants runs completed periods (daily = yesterday UTC, weekly = last ISO week containing yesterday).
func ProcessRebateGrants(ctx context.Context, pool *pgxpool.Pool, now time.Time, userLimit int) (int, error) {
	if userLimit <= 0 {
		userLimit = 2000
	}
	programs, err := loadRewardPrograms(ctx, pool, nil)
	if err != nil {
		return 0, err
	}
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	yesterday := today.AddDate(0, 0, -1)

	n := 0
	for _, p := range programs {
		if !p.Enabled || (p.Kind != RewardKindWagerRebate && p.Kind != RewardKindCashbackNetLoss) {
			continue
		}
		cfg, err := parseRebateConfig(p.Config)
		if err != nil || cfg.Percent <= 0 {
			continue
		}

		var start, end time.Time
		var periodKey string
		switch cfg.Period {
		case "weekly":
			// Settle full ISO week only on Monday UTC (yesterday was Sunday).
			if now.UTC().Weekday() != time.Monday {
				continue
			}
			end = today
			start = today.AddDate(0, 0, -7)
			periodKey = fmt.Sprintf("weekly:%s", start.Format("2006-01-02"))
		default:
			start, end = dayBoundsUTC(yesterday)
			periodKey = fmt.Sprintf("daily:%s", yesterday.Format("2006-01-02"))
		}

		rows, err := pool.Query(ctx, `
			SELECT DISTINCT user_id::text FROM ledger_entries
			WHERE pocket = 'cash' AND entry_type = 'game.debit'
			  AND created_at >= $1 AND created_at < $2
			LIMIT $3
		`, start, end, userLimit)
		if err != nil {
			continue
		}
		for rows.Next() {
			var uid string
			if err := rows.Scan(&uid); err != nil {
				continue
			}
			var base int64
			if p.Kind == RewardKindCashbackNetLoss {
				net, err := sumCashGameNetForWindow(ctx, pool, uid, start, end)
				if err != nil {
					continue
				}
				if net >= 0 {
					continue
				}
				base = -net
			} else {
				w, err := sumCashWagerForWindow(ctx, pool, uid, start, end)
				if err != nil || w <= 0 {
					continue
				}
				base = w
			}
			vipAdd, _ := VipRebatePercentAdd(ctx, pool, uid, p.ProgramKey)
			effectivePct := effectiveRebatePercent(cfg.Percent, vipAdd)
			if effectivePct <= 0 {
				continue
			}
			grant := (base * int64(effectivePct)) / 100
			if cfg.CapMinor > 0 && grant > cfg.CapMinor {
				grant = cfg.CapMinor
			}
			if grant <= 0 {
				continue
			}
			var exists bool
			_ = pool.QueryRow(ctx, `
				SELECT EXISTS(
					SELECT 1 FROM reward_rebate_grants
					WHERE user_id = $1::uuid AND reward_program_id = $2 AND period_key = $3
				)
			`, uid, p.ID, periodKey).Scan(&exists)
			if exists {
				continue
			}
			idem := fmt.Sprintf("bonus:rebate:%d:%s:%s", p.ID, uid, periodKey)
			inserted, err := GrantFromPromotionVersion(ctx, pool, GrantArgs{
				UserID:             uid,
				PromotionVersionID: p.PromotionVersionID,
				IdempotencyKey:     idem,
				GrantAmountMinor:   grant,
				Currency:           "USDT",
				DepositAmountMinor: 0,
			})
			if err != nil || !inserted {
				continue
			}
			_, _ = pool.Exec(ctx, `
				INSERT INTO reward_rebate_grants (user_id, reward_program_id, period_key, base_minor, grant_amount_minor, idempotency_key)
				VALUES ($1::uuid, $2, $3, $4, $5, $6)
				ON CONFLICT (user_id, reward_program_id, period_key) DO NOTHING
			`, uid, p.ID, periodKey, base, grant, idem)
			n++
		}
		rows.Close()
	}
	return n, nil
}
