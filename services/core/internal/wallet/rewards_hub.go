package wallet

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// activeBonusForHubStrip picks the "main" in‑progress instance for the My Bonuses top strip:
// non‑exempt (primary slot) first, else oldest by created_at (e.g. VIP tier exempt bonus).
// Statuses: active, pending, pending_review — same as WR eligibility on instances.
type activeBonusForHubStrip struct {
	InstanceID         string
	WrRemaining        int64
	GrantedAmountMinor int64
	NonExemptCount     int64
	ExemptInSlotCount  int64
}

func loadActiveBonusForHubStrip(ctx context.Context, pool *pgxpool.Pool, userID string) (activeBonusForHubStrip, error) {
	var out activeBonusForHubStrip
	err := pool.QueryRow(ctx, `
		WITH cand AS (
			SELECT
				id,
				(GREATEST(wr_required_minor - wr_contributed_minor, 0))::bigint AS wr_left,
				granted_amount_minor,
				created_at,
				COALESCE(exempt_from_primary_slot, false) AS ex
			FROM user_bonus_instances
			WHERE user_id = $1::uuid AND status IN ('active', 'pending', 'pending_review')
		), counts AS (
			SELECT
				COUNT(*) FILTER (WHERE ex = false)::bigint AS n_non,
				COUNT(*) FILTER (WHERE ex = true)::bigint AS n_ex
			FROM cand
		)
		SELECT
			c.id::text,
			c.wr_left,
			c.granted_amount_minor,
			co.n_non,
			co.n_ex
		FROM cand c
		CROSS JOIN counts co
		ORDER BY c.ex ASC, c.created_at ASC
		LIMIT 1
	`, userID).Scan(&out.InstanceID, &out.WrRemaining, &out.GrantedAmountMinor, &out.NonExemptCount, &out.ExemptInSlotCount)
	if err == pgx.ErrNoRows {
		return activeBonusForHubStrip{}, nil
	}
	if err != nil {
		return activeBonusForHubStrip{}, err
	}
	return out, nil
}

// hubStripLifetimePromoForInstance returns cumulative promo.grant in bonus_locked tagged to the instance, else 0.
func hubStripLifetimePromoForInstance(ctx context.Context, pool *pgxpool.Pool, userID, instanceID string) (int64, error) {
	if strings.TrimSpace(instanceID) == "" {
		return 0, nil
	}
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND pocket = 'bonus_locked'
		  AND entry_type = 'promo.grant'
		  AND (metadata->>'bonus_instance_id') = $2
	`, userID, instanceID).Scan(&sum)
	return sum, err
}

// hubStripNetBonusLockedForInstance returns net of ledger lines in bonus_locked with metadata bonus_instance_id
// (grant / forfeit / convert — game.debits are not tagged, so this can be 0 even when the wallet has funds).
func hubStripNetBonusLockedForInstance(ctx context.Context, pool *pgxpool.Pool, userID, instanceID string) (int64, error) {
	if strings.TrimSpace(instanceID) == "" {
		return 0, nil
	}
	var sum int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND pocket = 'bonus_locked'
		  AND (metadata->>'bonus_instance_id') = $2
	`, userID, instanceID).Scan(&sum)
	return sum, err
}

// computeRewardsHubAggregatesForStrip fills the 3 top metrics for the My Bonuses strip from the
// current in‑progress bonus (primary slot if present; otherwise a side / exempt bonus), not global totals.
func computeRewardsHubAggregatesForStrip(
	ctx context.Context, pool *pgxpool.Pool, userID string, globalBonusLocked int64,
) (wageringRem, bonusLocked, lifetimePromo int64, err error) {
	st, err := loadActiveBonusForHubStrip(ctx, pool, userID)
	if err != nil {
		return 0, 0, 0, err
	}
	if st.InstanceID == "" {
		return 0, 0, 0, nil
	}
	wr := st.WrRemaining
	if wr < 0 {
		wr = 0
	}

	lt, err := hubStripLifetimePromoForInstance(ctx, pool, userID, st.InstanceID)
	if err != nil {
		return 0, 0, 0, err
	}
	if lt <= 0 {
		lt = st.GrantedAmountMinor
	}

	tagged, err := hubStripNetBonusLockedForInstance(ctx, pool, userID, st.InstanceID)
	if err != nil {
		return 0, 0, 0, err
	}
	var bl int64
	// game.debit lines on bonus_locked usually omit metadata.bonus_instance_id, so a single primary
	// in‑progress instance maps to the whole wallet; when multiple in‑slot bonuses exist, prefer
	// tagged net when it is non‑zero, else total pool.
	switch {
	case st.NonExemptCount == 1 && st.ExemptInSlotCount == 0:
		bl = globalBonusLocked
	case tagged != 0:
		bl = tagged
	default:
		bl = globalBonusLocked
	}

	if bl < 0 {
		bl = 0
	}
	if lt < 0 {
		lt = 0
	}
	return wr, bl, lt, nil
}

// VIPStatusMap returns the same payload as GET /v1/vip/status.
// country is optional ISO country (e.g. X-Geo-Country) for tier_perks claimable offer checks.
func VIPStatusMap(ctx context.Context, pool *pgxpool.Pool, uid string, country string) (map[string]any, error) {
	var tierID *int
	var points, lifeWager int64
	err := pool.QueryRow(ctx, `
		SELECT tier_id, points_balance, lifetime_wager_minor
		FROM player_vip_state WHERE user_id = $1::uuid
	`, uid).Scan(&tierID, &points, &lifeWager)
	if err == pgx.ErrNoRows {
		tierID, points, lifeWager = nil, 0, 0
	} else if err != nil {
		return nil, err
	} else {
		if _, err := bonus.SyncPlayerVIPTierToWager(ctx, pool, uid); err != nil {
			return nil, err
		}
		err = pool.QueryRow(ctx, `SELECT tier_id FROM player_vip_state WHERE user_id = $1::uuid`, uid).Scan(&tierID)
		if err != nil {
			return nil, err
		}
	}

	var tierName string
	var nextName *string
	var nextMin *int64
	var minWager int64
	if tierID != nil {
		_ = pool.QueryRow(ctx, `SELECT name, min_lifetime_wager_minor FROM vip_tiers WHERE id = $1`, *tierID).Scan(&tierName, &minWager)
		_ = pool.QueryRow(ctx, `
			SELECT name, min_lifetime_wager_minor FROM vip_tiers
			WHERE min_lifetime_wager_minor > $1 ORDER BY min_lifetime_wager_minor ASC, id ASC LIMIT 1
		`, minWager).Scan(&nextName, &nextMin)
	} else {
		// No row, or wager below every tier threshold: show next milestone as lowest tier by min wager.
		tierName = "Not ranked"
		_ = pool.QueryRow(ctx, `
			SELECT name, min_lifetime_wager_minor FROM vip_tiers
			ORDER BY min_lifetime_wager_minor ASC, id ASC LIMIT 1
		`).Scan(&nextName, &nextMin)
	}

	progress := map[string]any{
		"lifetime_wager_minor": lifeWager,
	}
	if nextMin != nil && *nextMin > 0 {
		progress["next_tier_min_wager_minor"] = *nextMin
		if lifeWager < *nextMin {
			progress["remaining_wager_minor"] = *nextMin - lifeWager
		}
	}

	out := map[string]any{
		"tier":     tierName,
		"points":   points,
		"progress": progress,
	}
	if tierID != nil {
		out["tier_id"] = *tierID
	}
	if nextName != nil {
		out["next_tier"] = *nextName
	}
	if adds, err := bonus.VipRebateAddsForUser(ctx, pool, uid); err == nil && len(adds) > 0 {
		m := map[string]any{}
		for k, v := range adds {
			m[k] = v
		}
		out["rebate_percent_add_by_program"] = m
	}
	if rb, err := bonus.RakebackBoostStatusForUser(ctx, pool, uid, time.Now().UTC()); err == nil {
		out["rakeback_boost"] = rb
	}
	if rc, err := bonus.RakebackClaimStatusForUser(ctx, pool, uid); err == nil {
		out["rakeback_claim"] = rc
	}
	if tierID != nil {
		if perks, err := bonus.VipTierPerkCardsForUser(ctx, pool, uid, *tierID, country); err == nil && len(perks) > 0 {
			out["tier_perks"] = perks
		} else if err == nil {
			out["tier_perks"] = []map[string]any{}
		}
		// On perk load error, omit tier_perks so clients keep using programme tier_benefits.
	}
	return out, nil
}

// RewardsHubHandler GET /v1/rewards/hub
func RewardsHubHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		cc := strings.TrimSpace(strings.ToUpper(r.Header.Get("X-Geo-Country")))
		days := 7
		if v := r.URL.Query().Get("calendar_days"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 31 {
				days = n
			}
		}
		ctx := r.Context()
		now := time.Now().UTC()

		cal, err := bonus.BuildRewardsCalendar(ctx, pool, uid, days, now)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "calendar failed")
			return
		}
		hunt, err := bonus.GetHuntStatus(ctx, pool, uid, now)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "hunt failed")
			return
		}

		bonusWalletLocked, err := ledger.BalanceBonusLocked(ctx, pool, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "aggregates: bonus_locked failed")
			return
		}
		wrRemaining, bonusStripLocked, lifetimePromo, err := computeRewardsHubAggregatesForStrip(ctx, pool, uid, bonusWalletLocked)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "aggregates: strip failed")
			return
		}

		offers, err := bonus.ListAvailableOffersForPlayer(ctx, pool, uid, cc)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "offers failed")
			return
		}

		rows, err := pool.Query(ctx, `
			SELECT ubi.id::text, ubi.promotion_version_id, ubi.status, ubi.granted_amount_minor, ubi.currency,
				ubi.wr_required_minor, ubi.wr_contributed_minor, ubi.created_at,
				COALESCE(ubi.exempt_from_primary_slot, false),
				COALESCE(NULLIF(TRIM(pv.player_title), ''), NULLIF(TRIM(p.name), ''), ''), COALESCE(NULLIF(TRIM(pv.player_description), ''), ''), COALESCE(pv.bonus_type, ''),
				pv.published_at, pv.valid_from, pv.valid_to,
				COALESCE(ubi.snapshot, '{}'::jsonb),
				NULLIF(TRIM(pv.player_hero_image_url), '')
			FROM user_bonus_instances ubi
			LEFT JOIN promotion_versions pv ON pv.id = ubi.promotion_version_id
			LEFT JOIN promotions p ON p.id = pv.promotion_id
			WHERE ubi.user_id = $1::uuid
			ORDER BY ubi.created_at DESC
			LIMIT 30
		`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "instances failed")
			return
		}
		defer rows.Close()
		var instances []map[string]any
		for rows.Next() {
			var id, st, ccy, title, desc, btype string
			var pvid int64
			var g, wr, wc int64
			var exPrimary bool
			var ct time.Time
			var snap []byte
			var pubAt, vf, vt sql.NullTime
			var hero sql.NullString
			if err := rows.Scan(&id, &pvid, &st, &g, &ccy, &wr, &wc, &ct, &exPrimary, &title, &desc, &btype, &pubAt, &vf, &vt, &snap, &hero); err != nil {
				continue
			}
			item := map[string]any{
				"id": id, "promotion_version_id": pvid, "status": st,
				"granted_amount_minor": g, "currency": ccy,
				"wr_required_minor": wr, "wr_contributed_minor": wc,
				"exempt_from_primary_slot": exPrimary,
				"title": bonus.HumanizeOfferTitle(pvid, title, desc, btype), "bonus_type": btype,
				"description": desc,
				"created_at":  ct.UTC().Format(time.RFC3339),
			}
			if hero.Valid && strings.TrimSpace(hero.String) != "" {
				item["hero_image_url"] = bonus.PublicizeStoredAssetURL(strings.TrimSpace(hero.String))
			}
			d := bonus.PlayerSnapshotDetails(snap)
			bonus.MergePlayerDetailsSchedule(d, pubAt, vf, vt)
			if len(d) > 0 {
				item["details"] = d
			}
			instances = append(instances, item)
		}

		// Get bonus (deposit match): player chose the promo; show under Active before cash credits.
		var intentPVID int64
		if err := pool.QueryRow(ctx, `
			SELECT promotion_version_id FROM player_bonus_deposit_intents WHERE user_id = $1::uuid
		`, uid).Scan(&intentPVID); err == nil && intentPVID > 0 {
			hasBlocking := false
			for _, inst := range instances {
				if pv, ok := bonus.MapPromotionVersionID(inst); !ok || pv != intentPVID {
					continue
				}
				s := fmt.Sprint(inst["status"])
				if bonus.InstanceStatusBlocksHubIntentSynthetic(s) {
					hasBlocking = true
					break
				}
			}
			if !hasBlocking {
				var title, desc, hero sql.NullString
				_ = pool.QueryRow(ctx, `
					SELECT COALESCE(NULLIF(TRIM(pv.player_title), ''), NULLIF(TRIM(p.name), ''), 'Promotion'),
						COALESCE(NULLIF(TRIM(pv.player_description), ''), ''),
						NULLIF(TRIM(pv.player_hero_image_url), '')
					FROM promotion_versions pv
					JOIN promotions p ON p.id = pv.promotion_id
					WHERE pv.id = $1
				`, intentPVID).Scan(&title, &desc, &hero)
				synthID := fmt.Sprintf("promo-intent-%d", intentPVID)
				synthTitle := bonus.HumanizeOfferTitle(intentPVID, title.String, desc.String, "deposit_match")
				synth := map[string]any{
					"id":                   synthID,
					"promotion_version_id": intentPVID,
					"status":               "awaiting_deposit",
					"granted_amount_minor": int64(0),
					"currency":             "USDT",
					"wr_required_minor":    int64(0),
					"wr_contributed_minor": int64(0),
					"title":                synthTitle,
					"description":          desc.String,
					"created_at":           now.Format(time.RFC3339),
					"bonus_type":           "deposit_match",
				}
				if hero.Valid && strings.TrimSpace(hero.String) != "" {
					synth["hero_image_url"] = bonus.PublicizeStoredAssetURL(strings.TrimSpace(hero.String))
				}
				instances = append([]map[string]any{synth}, instances...)
			}
		}

		vip, err := VIPStatusMap(ctx, pool, uid, cc)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "vip failed")
			return
		}

		fsc, _ := bonus.LoadFreeSpinsV1Config(ctx, pool)
		var freeSpins []map[string]any
		if fsc.APIEnabled {
			freeSpins, _ = bonus.ListFreeSpinGrantsForUser(ctx, pool, uid, 20)
		}
		if freeSpins == nil {
			freeSpins = []map[string]any{}
		}
		missions, _ := bonus.ListMissionsForHub(ctx, pool, uid)
		if missions == nil {
			missions = []map[string]any{}
		}
		races, _ := bonus.ListActiveRaces(ctx, pool)
		if races == nil {
			races = []map[string]any{}
		}
		referral, _ := bonus.ListReferralSummaryByUser(ctx, pool, uid)
		if referral == nil {
			referral = map[string]any{}
		}

		out := map[string]any{
			"calendar":         cal,
			"hunt":             hunt,
			"vip":              vip,
			"bonus_instances":  instances,
			"available_offers": offers,
			"free_spin_grants": freeSpins,
			"missions":         missions,
			"races":            races,
			"referral":         referral,
			"aggregates": map[string]any{
				"bonus_locked_minor":       bonusStripLocked,
				"wagering_remaining_minor": wrRemaining,
				"lifetime_promo_minor":     lifetimePromo,
			},
		}
		if prev := bonus.VIPHubDeliveryPreview(ctx, pool); len(prev) > 0 {
			out["vip_delivery_preview"] = prev
		}
		if rain := bonus.VIPRainEligibilityForHub(ctx, pool, uid); len(rain) > 0 {
			out["rain_eligibility"] = rain
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// RewardsCalendarHandler GET /v1/rewards/calendar
func RewardsCalendarHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		days := 7
		if v := r.URL.Query().Get("days"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 31 {
				days = n
			}
		}
		cal, err := bonus.BuildRewardsCalendar(r.Context(), pool, uid, days, time.Now().UTC())
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "calendar failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"calendar": cal})
	}
}

// RewardsDailyClaimHandler POST /v1/rewards/daily/claim
// Legacy alias: claims the next eligible daily-hunt cash milestone.
func RewardsDailyClaimHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		paid, err := bonus.ClaimNextHuntRewardCash(r.Context(), pool, uid, time.Now().UTC(), "USDT")
		if err != nil {
			switch {
			case errors.Is(err, bonus.ErrHuntNothingToClaim):
				playerapi.WriteError(w, http.StatusConflict, "nothing_to_claim", "No daily hunt reward is claimable yet.")
			default:
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "claim failed")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "paid_minor": paid})
	}
}

// RewardsRakebackClaimHandler POST /v1/rewards/rakeback/claim — credit cash wallet for pending rebate grants.
func RewardsRakebackClaimHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		paid, err := bonus.ClaimPendingRakebackWallet(r.Context(), pool, uid, "USDT")
		if err != nil {
			switch {
			case errors.Is(err, bonus.ErrRakebackNothingToClaim):
				playerapi.WriteError(w, http.StatusConflict, "nothing_to_claim", "No rakeback is available to claim right now.")
			case errors.Is(err, bonus.ErrRakebackClaimBlocked):
				playerapi.WriteError(w, http.StatusForbidden, "claim_blocked", "Rakeback claims are not available for your account.")
			case errors.Is(err, bonus.ErrBonusesDisabled):
				playerapi.WriteError(w, http.StatusForbidden, "bonuses_disabled", "Rewards are temporarily unavailable.")
			default:
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "claim failed")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "paid_minor": paid})
	}
}
