package bonus

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PlayerOfferRow is a published version candidate for /bonuses/available.
type PlayerOfferRow struct {
	VersionID              int64
	RulesJSON              []byte
	Title                  *string
	Description            *string
	PromoCode              *string
	ValidFrom              *time.Time
	ValidTo                *time.Time
	Priority               int
	PublishedAt            time.Time
	DedupeGroupKey         *string
	OfferFamily            *string
	EligibilityFingerprint *string
	BonusType              *string
	HeroImageURL           *string
	// PlayerHubForceVisible skips schedule, segment, and trigger-type listing gates (admin "hub ON").
	PlayerHubForceVisible bool
	VIPOnly               bool
}

func versionUsesExplicitTargets(ctx context.Context, pool *pgxpool.Pool, versionID int64) (bool, error) {
	var n int64
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM promotion_targets WHERE promotion_version_id = $1
	`, versionID).Scan(&n)
	return n > 0, err
}

func userInPromotionTargets(ctx context.Context, pool *pgxpool.Pool, versionID int64, userID string) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT true FROM promotion_targets WHERE promotion_version_id = $1 AND user_id = $2::uuid
	`, versionID, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

func playerVIPSortOrder(ctx context.Context, pool *pgxpool.Pool, userID string) (int, error) {
	var tierID *int
	err := pool.QueryRow(ctx, `SELECT tier_id FROM player_vip_state WHERE user_id = $1::uuid`, userID).Scan(&tierID)
	if err == pgx.ErrNoRows || tierID == nil {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	var ord int
	err = pool.QueryRow(ctx, `SELECT sort_order FROM vip_tiers WHERE id = $1`, *tierID).Scan(&ord)
	if err != nil {
		return 0, nil
	}
	return ord, nil
}

// EligibleForOffer strict gate for listing (shared concepts with grant; does not guarantee grant).
func EligibleForOffer(ctx context.Context, pool *pgxpool.Pool, userID string, country string, row PlayerOfferRow) bool {
	now := time.Now().UTC()
	sched := VersionSchedule{ValidFrom: row.ValidFrom, ValidTo: row.ValidTo}
	if !OfferScheduleOpen(now, sched) {
		return false
	}
	rules, err := parseRules(row.RulesJSON)
	if err != nil {
		return false
	}
	if !SegmentTargetingMatches(ctx, pool, userID, country, row.VersionID, row.RulesJSON) {
		return false
	}

	// Trigger type: only surface deposit-triggered or generic as "available" for automation
	tt := strings.ToLower(strings.TrimSpace(rules.Trigger.Type))
	if tt != "" && tt != "deposit" {
		return false
	}
	return true
}

// ListAvailableOffersForPlayer returns strict-eligible published offers (marketing fields only).
func ListAvailableOffersForPlayer(ctx context.Context, pool *pgxpool.Pool, userID string, country string) ([]map[string]any, error) {
	var intentVersionID *int64
	var intentVID int64
	err := pool.QueryRow(ctx, `
		SELECT promotion_version_id FROM player_bonus_deposit_intents WHERE user_id = $1::uuid
	`, userID).Scan(&intentVID)
	if err == nil {
		intentVersionID = &intentVID
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	relin, errR := loadRelinquishedPromotionVersionIDs(ctx, pool, userID)
	if errR != nil {
		return nil, errR
	}

	rows, err2 := pool.Query(ctx, `
		SELECT pv.id, pv.rules, pv.player_title, pv.player_description, pv.promo_code,
			pv.valid_from, pv.valid_to, pv.priority, pv.published_at,
			pv.dedupe_group_key, pv.offer_family, pv.eligibility_fingerprint, pv.bonus_type,
			NULLIF(TRIM(pv.player_hero_image_url), ''),
			COALESCE(p.player_hub_force_visible, false),
			COALESCE(p.vip_only, false),
			p.name
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE pv.published_at IS NOT NULL
		  AND p.status != 'archived'
		  AND COALESCE(p.grants_paused, false) = false
		ORDER BY COALESCE(p.player_hub_force_visible, false) DESC,
			pv.priority DESC, pv.published_at DESC NULLS LAST, pv.id DESC
	`)
	if err2 != nil {
		return nil, err2
	}
	defer rows.Close()

	var candidates []PlayerOfferRow
	for rows.Next() {
		var row PlayerOfferRow
		var vf, vt sql.NullTime
		var title, desc, pcode *string
		var bonusType *string
		var hero sql.NullString
		var promoName string
		if err := rows.Scan(&row.VersionID, &row.RulesJSON, &title, &desc, &pcode, &vf, &vt, &row.Priority, &row.PublishedAt,
			&row.DedupeGroupKey, &row.OfferFamily, &row.EligibilityFingerprint, &bonusType, &hero, &row.PlayerHubForceVisible, &row.VIPOnly,
			&promoName); err != nil {
			continue
		}
		var displayTitle *string
		if title != nil {
			ts := strings.TrimSpace(*title)
			if ts != "" {
				displayTitle = &ts
			}
		}
		if displayTitle == nil {
			pn := strings.TrimSpace(promoName)
			if pn != "" {
				displayTitle = &pn
			}
		}
		row.Title = displayTitle
		row.Description = desc
		row.PromoCode = pcode
		row.BonusType = bonusType
		if hero.Valid {
			hs := strings.TrimSpace(hero.String)
			if hs != "" {
				row.HeroImageURL = &hs
			}
		}
		if vf.Valid {
			t := vf.Time
			row.ValidFrom = &t
		}
		if vt.Valid {
			t := vt.Time
			row.ValidTo = &t
		}
		candidates = append(candidates, row)
	}

	seen := map[string]bool{}
	var out []map[string]any
	for _, c := range candidates {
		// User forfeited or cancelled this offer; do not show again as available.
		if _, done := relin[c.VersionID]; done {
			continue
		}
		// User already "activated" this promo (Get bonus) — it moves to Active until a deposit runs matching logic.
		if intentVersionID != nil && c.VersionID == *intentVersionID {
			continue
		}
		// VIP-only promotions are never listed in general player offer discovery.
		if c.VIPOnly {
			continue
		}
		if !c.PlayerHubForceVisible && !EligibleForOffer(ctx, pool, userID, country, c) {
			continue
		}
		rules, _ := parseRules(c.RulesJSON)
		fam := ""
		if c.OfferFamily != nil {
			fam = *c.OfferFamily
		}
		if fam == "" {
			fam, _ = DeriveOfferFamily(c.RulesJSON)
		}
		fp := ""
		if c.EligibilityFingerprint != nil {
			fp = *c.EligibilityFingerprint
		}
		if fp == "" {
			fp, _ = EligibilityFingerprintHex(c.RulesJSON, fam)
		}
		dg := ""
		if c.DedupeGroupKey != nil {
			dg = *c.DedupeGroupKey
		}
		exKey := ExclusivityKey(dg, fam, fp)
		if seen[exKey] {
			continue
		}
		seen[exKey] = true

		title := ""
		if c.Title != nil {
			title = strings.TrimSpace(*c.Title)
		}
		desc := ""
		if c.Description != nil {
			desc = *c.Description
		}
		kind := "auto_on_deposit"
		promoCodeOut := ""
		if c.PromoCode != nil && strings.TrimSpace(*c.PromoCode) != "" {
			kind = "redeem_code"
			promoCodeOut = strings.TrimSpace(*c.PromoCode)
		}
		bonusTypeOut := ""
		if c.BonusType != nil {
			bonusTypeOut = strings.TrimSpace(*c.BonusType)
		}
		displayTitle := HumanizeOfferTitle(c.VersionID, title, desc, bonusTypeOut)
		m := map[string]any{
			"promotion_version_id": c.VersionID,
			"title":                displayTitle,
			"description":          desc,
			"kind":                 kind,
			"schedule_summary":     scheduleSummary(c.ValidFrom, c.ValidTo),
			"trigger_type":         rules.Trigger.Type,
			"bonus_type":           bonusTypeOut,
		}
		if c.ValidFrom != nil {
			m["valid_from"] = c.ValidFrom.UTC().Format(time.RFC3339)
		}
		if c.ValidTo != nil {
			m["valid_to"] = c.ValidTo.UTC().Format(time.RFC3339)
		}
		if promoCodeOut != "" {
			m["promo_code"] = promoCodeOut
		}
		if c.HeroImageURL != nil && strings.TrimSpace(*c.HeroImageURL) != "" {
			m["hero_image_url"] = PublicizeStoredAssetURL(strings.TrimSpace(*c.HeroImageURL))
		}
		if c.PlayerHubForceVisible {
			m["hub_boost"] = true
		}
		if od := HubOfferDetailsMap(ctx, pool, c.VersionID, c.RulesJSON); len(od) > 0 {
			m["offer_details"] = od
		}
		out = append(out, m)
	}
	return out, nil
}

func scheduleSummary(from, to *time.Time) string {
	if from == nil && to == nil {
		return "Active"
	}
	if from != nil && to != nil {
		return from.UTC().Format(time.RFC3339) + " – " + to.UTC().Format(time.RFC3339)
	}
	if from != nil {
		return "From " + from.UTC().Format(time.RFC3339)
	}
	return "Until " + to.UTC().Format(time.RFC3339)
}
