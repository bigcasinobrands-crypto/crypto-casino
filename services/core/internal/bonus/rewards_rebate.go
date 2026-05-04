package bonus

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
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

func effectiveRebatePercent(basePct float64, vipAdd float64) float64 {
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
	if pool == nil {
		return 0, nil
	}
	return ledger.SumSuccessfulCashStakeForWindow(ctx, pool, userID, start, end)
}

func userRebateBlocked(ctx context.Context, pool *pgxpool.Pool, userID string) bool {
	var blocked bool
	_ = pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM users
			WHERE id = $1::uuid
			  AND (
				account_closed_at IS NOT NULL OR
				(self_excluded_until IS NOT NULL AND self_excluded_until > now())
			  )
		)
	`, userID).Scan(&blocked)
	if blocked {
		return true
	}
	var risk string
	_ = pool.QueryRow(ctx, `
		SELECT decision FROM bonus_risk_decisions
		WHERE user_id = $1::uuid
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, userID).Scan(&risk)
	return risk == "manual_review" || risk == "denied"
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
			WHERE pocket = 'cash' AND entry_type IN ('game.debit', 'game.rollback')
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
				net, err := ledger.SumCashGameNetForWindow(ctx, pool, uid, start, end)
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
			tierID, _, hasTier := VIPTierSnapshotAt(ctx, pool, uid, start)
			vipAdd := 0.0
			if hasTier && tierID != nil {
				vipAdd, _ = vipRebatePercentAddForTier(ctx, pool, *tierID, p.ProgramKey)
			}
			effectivePct := effectiveRebatePercent(float64(cfg.Percent), vipAdd)
			if effectivePct <= 0 {
				continue
			}
			if cfg.MinQualifyingWagerMinor > 0 {
				w, err := sumCashWagerForWindow(ctx, pool, uid, start, end)
				if err != nil || w < cfg.MinQualifyingWagerMinor {
					continue
				}
			}
			if userRebateBlocked(ctx, pool, uid) {
				continue
			}
			grant := int64(math.Round((float64(base) * effectivePct) / 100.0))
			if cfg.CapMinor > 0 && grant > cfg.CapMinor {
				grant = cfg.CapMinor
			}
			if cfg.BurstMultiplier > 1 {
				burstDelta := int64(float64(grant)*(cfg.BurstMultiplier-1.0) + 0.5)
				if cfg.BurstCapMinor > 0 && burstDelta > cfg.BurstCapMinor {
					burstDelta = cfg.BurstCapMinor
				}
				if burstDelta > 0 {
					grant += burstDelta
					tid := tierID
					_ = RecordRakebackBurstConsumption(
						ctx,
						pool,
						uid,
						periodKey,
						fmt.Sprintf("bonus:rebate:burst:%d:%s:%s", p.ID, uid, periodKey),
						tid,
						burstDelta,
					)
				}
			}
			if cfg.MaxPayoutMinor > 0 && grant > cfg.MaxPayoutMinor {
				grant = cfg.MaxPayoutMinor
			}
			if grant <= 0 {
				continue
			}
			idem := fmt.Sprintf("bonus:rebate:%d:%s:%s", p.ID, uid, periodKey)
			tag, err := pool.Exec(ctx, `
				INSERT INTO reward_rebate_grants (user_id, reward_program_id, period_key, base_minor, grant_amount_minor, idempotency_key, payout_status)
				VALUES ($1::uuid, $2, $3, $4, $5, $6, 'pending_wallet')
				ON CONFLICT (user_id, reward_program_id, period_key) DO NOTHING
			`, uid, p.ID, periodKey, base, grant, idem)
			if err != nil {
				continue
			}
			if tag.RowsAffected() > 0 {
				n++
			}
		}
		rows.Close()
	}
	return n, nil
}
