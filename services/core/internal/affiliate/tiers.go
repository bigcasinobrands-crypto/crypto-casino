package affiliate

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RefreshReferralTiers assigns each unlocked partner the highest active tier
// (by sort_order) whose thresholds are met by referred-player metrics.
func RefreshReferralTiers(ctx context.Context, pool *pgxpool.Pool) (updated int, err error) {
	if pool == nil {
		return 0, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT p.id::text
		FROM affiliate_partners p
		WHERE p.status = 'active' AND NOT p.tier_locked
	`)
	if err != nil {
		return 0, fmt.Errorf("affiliate: list partners for tier refresh: %w", err)
	}
	defer rows.Close()

	var partnerIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		partnerIDs = append(partnerIDs, id)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	tierRows, err := pool.Query(ctx, `
		SELECT id::text, sort_order,
		       COALESCE(min_referred_signups, 0),
		       COALESCE(min_referred_depositors, 0),
		       COALESCE(min_referred_deposit_volume_minor, 0)
		FROM referral_program_tiers
		WHERE active
		ORDER BY sort_order DESC, id DESC
	`)
	if err != nil {
		return 0, fmt.Errorf("affiliate: load tiers: %w", err)
	}
	defer tierRows.Close()

	type tierRule struct {
		id            string
		sort          int
		minSignups    int
		minDepositors int
		minVolume     int64
	}
	var tiers []tierRule
	for tierRows.Next() {
		var t tierRule
		if err := tierRows.Scan(&t.id, &t.sort, &t.minSignups, &t.minDepositors, &t.minVolume); err != nil {
			return 0, err
		}
		tiers = append(tiers, t)
	}
	if err := tierRows.Err(); err != nil {
		return 0, err
	}

	for _, pid := range partnerIDs {
		var signups, depositors int
		var vol int64
		err := pool.QueryRow(ctx, `
			WITH refs AS (
				SELECT ar.user_id AS referee_id
				FROM affiliate_referrals ar
				WHERE ar.partner_id = $1::uuid
			),
			dep AS (
				SELECT r.referee_id,
				       COALESCE(SUM(le.amount_minor), 0)::bigint AS dep_sum
				FROM refs r
				JOIN ledger_entries le ON le.user_id = r.referee_id
				WHERE le.entry_type = 'deposit.credit' AND le.amount_minor > 0
				GROUP BY r.referee_id
			)
			SELECT
				(SELECT COUNT(*)::int FROM refs),
				(SELECT COUNT(*)::int FROM dep),
				COALESCE((SELECT SUM(dep_sum) FROM dep), 0)::bigint
		`, pid).Scan(&signups, &depositors, &vol)
		if err != nil {
			return updated, fmt.Errorf("affiliate: metrics partner %s: %w", pid, err)
		}

		chosen := ""
		for _, tr := range tiers {
			if signups >= tr.minSignups && depositors >= tr.minDepositors && vol >= tr.minVolume {
				chosen = tr.id
				break
			}
		}
		if chosen == "" {
			continue
		}
		tag, err := pool.Exec(ctx, `
			UPDATE affiliate_partners
			SET tier_id = $2::int, updated_at = now()
			WHERE id = $1::uuid AND NOT tier_locked AND (tier_id IS DISTINCT FROM $2::int)
		`, pid, chosen)
		if err != nil {
			return updated, fmt.Errorf("affiliate: update tier partner %s: %w", pid, err)
		}
		if tag.RowsAffected() > 0 {
			updated++
		}
	}
	return updated, nil
}
