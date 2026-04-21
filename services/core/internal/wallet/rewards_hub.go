package wallet

import (
	"context"
	"encoding/json"
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

// VIPStatusMap returns the same payload as GET /v1/vip/status.
func VIPStatusMap(ctx context.Context, pool *pgxpool.Pool, uid string) (map[string]any, error) {
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
	}

	var tierName string
	var nextName *string
	var nextMin *int64
	var sortOrder int
	if tierID != nil {
		_ = pool.QueryRow(ctx, `SELECT name, sort_order FROM vip_tiers WHERE id = $1`, *tierID).Scan(&tierName, &sortOrder)
		_ = pool.QueryRow(ctx, `
			SELECT name, min_lifetime_wager_minor FROM vip_tiers
			WHERE sort_order > $1 ORDER BY sort_order ASC LIMIT 1
		`, sortOrder).Scan(&nextName, &nextMin)
	} else {
		// No VIP row yet: treat as Tadpole (entry tier); next rank is first tier above sort 0 (FISH).
		tierName = "Tadpole"
		_ = pool.QueryRow(ctx, `
			SELECT name, min_lifetime_wager_minor FROM vip_tiers
			ORDER BY sort_order ASC LIMIT 1 OFFSET 1
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

		bonusLocked, _ := ledger.BalanceBonusLocked(ctx, pool, uid)
		var wrRemaining int64
		_ = pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(GREATEST(wr_required_minor - wr_contributed_minor, 0)), 0)::bigint
			FROM user_bonus_instances
			WHERE user_id = $1::uuid AND status IN ('active', 'pending', 'pending_review')
		`, uid).Scan(&wrRemaining)

		var lifetimePromo int64
		_ = pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
			WHERE user_id = $1::uuid AND pocket = 'bonus_locked' AND entry_type = 'promo.grant'
		`, uid).Scan(&lifetimePromo)

		offers, err := bonus.ListAvailableOffersForPlayer(ctx, pool, uid, cc)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "offers failed")
			return
		}

		rows, err := pool.Query(ctx, `
			SELECT ubi.id::text, ubi.promotion_version_id, ubi.status, ubi.granted_amount_minor, ubi.currency,
				ubi.wr_required_minor, ubi.wr_contributed_minor, ubi.created_at,
				COALESCE(pv.player_title, ''), COALESCE(pv.bonus_type, '')
			FROM user_bonus_instances ubi
			LEFT JOIN promotion_versions pv ON pv.id = ubi.promotion_version_id
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
			var id, st, ccy, title, btype string
			var pvid int64
			var g, wr, wc int64
			var ct time.Time
			if err := rows.Scan(&id, &pvid, &st, &g, &ccy, &wr, &wc, &ct, &title, &btype); err != nil {
				continue
			}
			instances = append(instances, map[string]any{
				"id": id, "promotion_version_id": pvid, "status": st,
				"granted_amount_minor": g, "currency": ccy,
				"wr_required_minor": wr, "wr_contributed_minor": wc,
				"title": title, "bonus_type": btype,
				"created_at": ct.UTC().Format(time.RFC3339),
			})
		}

		vip, err := VIPStatusMap(ctx, pool, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "vip failed")
			return
		}

		out := map[string]any{
			"calendar":         cal,
			"hunt":             hunt,
			"vip":              vip,
			"bonus_instances":  instances,
			"available_offers": offers,
			"aggregates": map[string]any{
				"bonus_locked_minor":       bonusLocked,
				"wagering_remaining_minor": wrRemaining,
				"lifetime_promo_minor":     lifetimePromo,
			},
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
func RewardsDailyClaimHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		var body struct {
			Date string `json:"date"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Date) == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "date required (YYYY-MM-DD)")
			return
		}
		err := bonus.ClaimDailyReward(r.Context(), pool, uid, strings.TrimSpace(body.Date), "USDT")
		if err != nil {
			switch {
			case err == bonus.ErrDailyNoProgram:
				playerapi.WriteError(w, http.StatusNotFound, "not_found", "daily rewards not configured")
			case err == bonus.ErrDailyBlockedByWagering:
				playerapi.WriteError(w, http.StatusConflict, "active_wagering",
					"You have a bonus with wagering in progress. Finish that wagering (or contact support) before claiming daily rewards.")
			case err == bonus.ErrDailyNotClaimable:
				playerapi.WriteError(w, http.StatusConflict, "conflict", "This reward cannot be claimed (wrong date, already claimed, or offer unavailable).")
			default:
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "claim failed")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}
