package bonus

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProcessRakebackBoostSettlements books extra rakeback from finished timed boosts into reward_rebate_grants
// (payout_status pending_wallet), using wager in [claimed_at, active_until_at).
func ProcessRakebackBoostSettlements(ctx context.Context, pool *pgxpool.Pool, now time.Time, rowLimit int) (int, error) {
	if rowLimit <= 0 {
		rowLimit = 500
	}
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.user_id::text, c.benefit_id, c.claimed_at, c.active_until_at
		FROM vip_rakeback_boost_claims c
		WHERE c.active_until_at <= $1 AND c.rebate_settled_at IS NULL
		ORDER BY c.active_until_at ASC
		LIMIT $2
	`, now.UTC(), rowLimit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type row struct {
		id         int64
		userID     string
		benefitID  int64
		claimedAt  time.Time
		activeTill time.Time
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.userID, &r.benefitID, &r.claimedAt, &r.activeTill); err != nil {
			continue
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	n := 0
	for _, r := range list {
		ok, err := settleOneRakebackBoostClaim(ctx, pool, r.id, r.userID, r.benefitID, r.claimedAt, r.activeTill)
		if err != nil {
			continue
		}
		if ok {
			n++
		}
	}
	return n, nil
}

func settleOneRakebackBoostClaim(ctx context.Context, pool *pgxpool.Pool, claimID int64, userID string, benefitID int64, claimedAt, activeUntil time.Time) (booked bool, err error) {
	var raw []byte
	err = pool.QueryRow(ctx, `SELECT config FROM vip_tier_benefits WHERE id = $1`, benefitID).Scan(&raw)
	if err != nil {
		if err == pgx.ErrNoRows {
			_, _ = pool.Exec(ctx, `UPDATE vip_rakeback_boost_claims SET rebate_settled_at = now() WHERE id = $1`, claimID)
			return false, nil
		}
		return false, err
	}
	cfg, err := parseRakebackBoostScheduleConfig(raw)
	if err != nil || cfg.BoostPercentAdd <= 0 {
		_, _ = pool.Exec(ctx, `UPDATE vip_rakeback_boost_claims SET rebate_settled_at = now() WHERE id = $1`, claimID)
		return false, nil
	}
	key := strings.TrimSpace(cfg.RebateProgramKey)
	if key == "" {
		_, _ = pool.Exec(ctx, `UPDATE vip_rakeback_boost_claims SET rebate_settled_at = now() WHERE id = $1`, claimID)
		return false, nil
	}
	var progID int64
	err = pool.QueryRow(ctx, `
		SELECT id FROM reward_programs
		WHERE program_key = $1 AND enabled = true
		  AND kind IN ('wager_rebate', 'cashback_net_loss')
		LIMIT 1
	`, key).Scan(&progID)
	if err != nil {
		if err == pgx.ErrNoRows {
			_, _ = pool.Exec(ctx, `UPDATE vip_rakeback_boost_claims SET rebate_settled_at = now() WHERE id = $1`, claimID)
			return false, nil
		}
		return false, err
	}

	start := claimedAt.UTC()
	end := activeUntil.UTC()
	wager, err := sumCashWagerForWindow(ctx, pool, userID, start, end)
	if err != nil {
		return false, err
	}
	grant := int64(math.Round(float64(wager) * cfg.BoostPercentAdd / 100.0))

	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if grant > 0 && !userRebateBlocked(ctx, pool, userID) {
		periodKey := fmt.Sprintf("boost:%d", claimID)
		idem := fmt.Sprintf("bonus:rebate:boost:settle:%d", claimID)
		_, err = tx.Exec(ctx, `
			INSERT INTO reward_rebate_grants (user_id, reward_program_id, period_key, base_minor, grant_amount_minor, idempotency_key, payout_status)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, 'pending_wallet')
			ON CONFLICT (user_id, reward_program_id, period_key) DO NOTHING
		`, userID, progID, periodKey, wager, grant, idem)
		if err != nil {
			return false, err
		}
	}

	tag, err := tx.Exec(ctx, `
		UPDATE vip_rakeback_boost_claims SET rebate_settled_at = now()
		WHERE id = $1 AND rebate_settled_at IS NULL
	`, claimID)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
