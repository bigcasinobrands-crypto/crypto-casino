package affiliate

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const referralCodeBytes = 8 // 8 bytes → 13 chars base32 (StdEncoding, no padding)

// NormalizeReferralCode trims and uppercases referral codes for lookups.
func NormalizeReferralCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// RandomReferralCode returns an unguessable ASCII code (RFC 4648 base32, A–Z2–7).
func RandomReferralCode() (string, error) {
	var raw [referralCodeBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	return enc.EncodeToString(raw[:]), nil
}

// EnsureAffiliatePartner creates an affiliate_partners row for the user when missing.
// referral_code is always a fresh opaque string; tier defaults to the lowest active tier.
func EnsureAffiliatePartner(ctx context.Context, pool *pgxpool.Pool, userID string) (partnerID, referralCode string, err error) {
	if pool == nil || strings.TrimSpace(userID) == "" {
		return "", "", nil
	}
	_ = pool.QueryRow(ctx, `
		SELECT id::text, referral_code FROM affiliate_partners WHERE user_id = $1::uuid
	`, userID).Scan(&partnerID, &referralCode)
	if partnerID != "" {
		return partnerID, referralCode, nil
	}

	for attempt := 0; attempt < 8; attempt++ {
		code, genErr := RandomReferralCode()
		if genErr != nil {
			return "", "", genErr
		}
		var pid string
		insertErr := pool.QueryRow(ctx, `
			WITH def AS (
				SELECT id AS tier_id FROM referral_program_tiers WHERE active ORDER BY sort_order ASC, id ASC LIMIT 1
			)
			INSERT INTO affiliate_partners (user_id, referral_code, display_name, revenue_share_bps, status, tier_id)
			SELECT $1::uuid, $2, '', 0, 'active', def.tier_id FROM def
			ON CONFLICT (user_id) DO NOTHING
			RETURNING id::text
		`, userID, code).Scan(&pid)
		if insertErr == nil && pid != "" {
			return pid, code, nil
		}
		// race: another request inserted first
		_ = pool.QueryRow(ctx, `
			SELECT id::text, referral_code FROM affiliate_partners WHERE user_id = $1::uuid
		`, userID).Scan(&partnerID, &referralCode)
		if partnerID != "" {
			return partnerID, referralCode, nil
		}
	}
	_ = pool.QueryRow(ctx, `
		SELECT id::text, referral_code FROM affiliate_partners WHERE user_id = $1::uuid
	`, userID).Scan(&partnerID, &referralCode)
	return partnerID, referralCode, nil
}
