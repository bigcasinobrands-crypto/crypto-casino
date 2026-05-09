package affiliate

import (
	"context"
	"fmt"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HubReferralSummary builds the `referral` object for GET /v1/rewards/hub.
func HubReferralSummary(ctx context.Context, pool *pgxpool.Pool, userID string) (map[string]any, error) {
	if pool == nil {
		return map[string]any{}, nil
	}
	_, code, err := EnsureAffiliatePartner(ctx, pool, userID)
	if err != nil {
		return nil, fmt.Errorf("affiliate hub: ensure partner: %w", err)
	}

	var tierID pgtype.Int4
	var tierName string
	var ngrBps, depBps pgtype.Int4
	_ = pool.QueryRow(ctx, `
		SELECT p.tier_id, COALESCE(t.name, ''), t.ngr_revshare_bps, t.deposit_revshare_bps
		FROM affiliate_partners p
		LEFT JOIN referral_program_tiers t ON t.id = p.tier_id AND t.active
		WHERE p.user_id = $1::uuid
	`, userID).Scan(&tierID, &tierName, &ngrBps, &depBps)

	var partnerUUID string
	_ = pool.QueryRow(ctx, `SELECT id::text FROM affiliate_partners WHERE user_id = $1::uuid`, userID).Scan(&partnerUUID)

	var refCount, depCount, depTxnCount int64
	var depVolume int64
	if partnerUUID != "" {
		_ = pool.QueryRow(ctx, `
			WITH refs AS (
				SELECT ar.user_id AS referee_id
				FROM affiliate_referrals ar
				WHERE ar.partner_id = $1::uuid
			),
			dep AS (
				SELECT r.referee_id,
				       COUNT(*)::bigint AS n,
				       COALESCE(SUM(le.amount_minor), 0)::bigint AS vol
				FROM refs r
				JOIN ledger_entries le ON le.user_id = r.referee_id
				WHERE le.entry_type = 'deposit.credit' AND le.amount_minor > 0
				GROUP BY r.referee_id
			)
			SELECT
				(SELECT COUNT(*)::bigint FROM refs),
				(SELECT COUNT(*)::bigint FROM dep),
				COALESCE((SELECT SUM(n) FROM dep), 0)::bigint,
				COALESCE((SELECT SUM(vol) FROM dep), 0)::bigint
		`, partnerUUID).Scan(&refCount, &depCount, &depTxnCount, &depVolume)
	}

	var pendingMinor, paidMinor int64
	if partnerUUID != "" {
		_ = pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(commission_minor), 0)::bigint
			FROM affiliate_commission_grants
			WHERE partner_id = $1::uuid AND status = 'pending'
		`, partnerUUID).Scan(&pendingMinor)
	}
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type = $2 AND amount_minor > 0
	`, userID, ledger.EntryTypeAffiliatePayout).Scan(&paidMinor)

	nextTier, progPct := nextTierProgress(ctx, pool, tierID, refCount, depCount, depVolume)

	out := map[string]any{
		"link_code":           code,
		"tier_name":           tierName,
		"stages":              map[string]int64{"referrals": refCount, "signups": refCount, "depositors": depCount, "deposits": depTxnCount},
		"description":         "Earn commission when friends you refer play and deposit. Higher tiers unlock better rates.",
		"pending_minor":       pendingMinor,
		"lifetime_paid_minor": paidMinor,
		"next_tier":           nextTier,
		"tier_progress_pct":   progPct,
	}
	if tierID.Valid {
		out["tier_id"] = tierID.Int32
	}
	if ngrBps.Valid {
		out["ngr_revshare_bps"] = ngrBps.Int32
	}
	if depBps.Valid {
		out["deposit_revshare_bps"] = depBps.Int32
	}
	return out, nil
}

func nextTierProgress(ctx context.Context, pool *pgxpool.Pool, curTierID pgtype.Int4, signups, depositors, volume int64) (map[string]any, float64) {
	curSort := -1
	if curTierID.Valid {
		_ = pool.QueryRow(ctx, `
			SELECT sort_order FROM referral_program_tiers WHERE id = $1
		`, curTierID.Int32).Scan(&curSort)
	}

	var nextID int32
	var nextName string
	var minSig, minDep pgtype.Int4
	var minVol pgtype.Int8
	var nextNgr pgtype.Int4
	err := pool.QueryRow(ctx, `
		SELECT t.id, t.name, t.min_referred_signups, t.min_referred_depositors, t.min_referred_deposit_volume_minor,
		       t.ngr_revshare_bps
		FROM referral_program_tiers t
		WHERE t.active AND t.sort_order > $1
		ORDER BY t.sort_order ASC, t.id ASC
		LIMIT 1
	`, curSort).Scan(&nextID, &nextName, &minSig, &minDep, &minVol, &nextNgr)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, 0
		}
		return nil, 0
	}

	ms := 0
	if minSig.Valid {
		ms = int(minSig.Int32)
	}
	md := 0
	if minDep.Valid {
		md = int(minDep.Int32)
	}
	mv := int64(0)
	if minVol.Valid {
		mv = minVol.Int64
	}

	var parts []float64
	if ms > 0 {
		parts = append(parts, minF(1.0, float64(signups)/float64(ms)))
	}
	if md > 0 {
		parts = append(parts, minF(1.0, float64(depositors)/float64(md)))
	}
	if mv > 0 {
		parts = append(parts, minF(1.0, float64(volume)/float64(mv)))
	}
	var pct float64
	if len(parts) > 0 {
		s := 0.0
		for _, p := range parts {
			s += p
		}
		pct = (s / float64(len(parts))) * 100
	}

	m := map[string]any{
		"id":                                 int(nextID),
		"name":                               nextName,
		"min_referred_signups":               ms,
		"min_referred_depositors":            md,
		"min_referred_deposit_volume_minor": mv,
	}
	if nextNgr.Valid {
		m["ngr_revshare_bps"] = nextNgr.Int32
	}
	return m, pct
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
