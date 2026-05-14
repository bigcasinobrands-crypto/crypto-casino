package adminops

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
)

const (
	redisKeyAdminDashboardSuppressDisplay = "admin:dashboard:suppress_metrics_display"
	redisPrefixAdminDashboardCache        = "admin:dashboard:cache:"
)

func (h *Handler) dashboardDisplaySuppressed(ctx context.Context) bool {
	if h == nil || h.Redis == nil {
		return false
	}
	s, err := h.Redis.Get(ctx, redisKeyAdminDashboardSuppressDisplay).Result()
	return err == nil && strings.TrimSpace(s) != ""
}

func (h *Handler) redisDeleteDashboardDisplayCacheKeys(ctx context.Context) ([]string, error) {
	if h == nil || h.Redis == nil {
		return nil, nil
	}
	var cleared []string
	var cursor uint64
	for {
		var keys []string
		var err error
		keys, cursor, err = h.Redis.Scan(ctx, cursor, redisPrefixAdminDashboardCache+"*", 64).Result()
		if err != nil {
			return cleared, err
		}
		for _, k := range keys {
			if err := h.Redis.Del(ctx, k).Err(); err != nil {
				return cleared, err
			}
			cleared = append(cleared, k)
		}
		if cursor == 0 {
			break
		}
	}
	return cleared, nil
}

func zeroDashboardKPIsMap() map[string]any {
	return map[string]any{
		"ggr_24h": int64(0), "ggr_7d": int64(0), "ggr_30d": int64(0), "ggr_all": int64(0),
		"total_wagered_24h": int64(0), "total_wagered_7d": int64(0), "total_wagered_30d": int64(0), "total_wagered_all": int64(0),
		"deposits_24h": int64(0), "deposits_7d": int64(0), "deposits_30d": int64(0),
		"deposits_count_24h": int64(0), "deposits_count_7d": int64(0), "deposits_count_30d": int64(0),
		"withdrawals_24h": int64(0), "withdrawals_7d": int64(0), "withdrawals_30d": int64(0),
		"withdrawals_count_24h": int64(0), "withdrawals_count_7d": int64(0), "withdrawals_count_30d": int64(0),
		"net_cash_flow_30d":  int64(0),
		"active_players_24h": int64(0), "active_players_7d": int64(0), "active_players_30d": int64(0),
		"new_registrations_24h": int64(0), "new_registrations_7d": int64(0), "new_registrations_30d": int64(0),
		"bonus_cost_24h": int64(0), "bonus_cost_7d": int64(0), "bonus_cost_30d": int64(0),
		"reward_expense_24h": int64(0), "reward_expense_7d": int64(0), "reward_expense_30d": int64(0),
		"ngr_24h": int64(0), "ngr_7d": int64(0), "ngr_30d": int64(0),
		"arpu_24h": float64(0), "arpu_7d": float64(0), "arpu_30d": float64(0),
		"avg_deposit_size_30d": int64(0), "deposit_conversion_rate": float64(0),
		"pending_withdrawals_value": int64(0), "pending_withdrawals_count": int64(0),
		"display_suppressed":        true,
		"display_suppression_scope": "derived_dashboard_metrics_only",
	}
}

func zeroDashboardChartsMap() map[string]any {
	return map[string]any{
		"deposits_by_day":          []map[string]any{},
		"withdrawals_by_day":       []map[string]any{},
		"ggr_by_day":               []map[string]any{},
		"registrations_by_day":     []map[string]any{},
		"game_launches_by_day":     []map[string]any{},
		"bonus_grants_by_day":      []map[string]any{},
		"display_suppressed":       true,
		"display_suppression_note": "Charts cleared for display reset; source ledger rows unchanged.",
	}
}

func zeroTopGamesMap() map[string]any {
	return map[string]any{
		"top_by_launches":    []map[string]any{},
		"top_by_ggr":         []map[string]any{},
		"display_suppressed": true,
	}
}

func zeroPlayerStatsMap() map[string]any {
	return map[string]any{
		"total_registered":        int64(0),
		"total_with_deposit":      int64(0),
		"total_active_7d":         int64(0),
		"total_active_30d":        int64(0),
		"deposit_conversion_rate": float64(0),
		"avg_ltv_minor":           int64(0),
		"top_depositors":          []map[string]any{},
		"registrations_trend":     []map[string]any{},
		"display_suppressed":      true,
	}
}

func zeroBonusHubDashboardMap() map[string]any {
	return map[string]any{
		"promotions_non_archived": int64(0),
		"active_bonus_instances":  int64(0),
		"grants_last_24h":         int64(0),
		"risk_queue_pending":      int64(0),
		"total_bonus_cost_30d":    int64(0),
		"wr_completion_rate":      float64(0),
		"forfeiture_rate":         float64(0),
		"expiration_rate":         float64(0),
		"total_forfeited":         int64(0),
		"total_expired":           int64(0),
		"avg_grant_amount_minor":  int64(0),
		"bonus_pct_of_ggr":        float64(0),
		"display_suppressed":      true,
	}
}

func zeroChallengesSummaryMap() map[string]any {
	return map[string]any{
		"active_challenges":       0,
		"draft_challenges":        0,
		"entries_last_30d":        0,
		"challenge_wagered_minor": int64(0),
		"prizes_paid_minor_30d":   int64(0),
		"flagged_pending":         0,
		"display_suppressed":      true,
	}
}

func zeroTrafficAnalyticsPayload(period string) TrafficAnalyticsPayload {
	return TrafficAnalyticsPayload{
		Period:          period,
		SessionsTotal:   0,
		UniqueVisitors:  0,
		NewVisitorsPct:  0,
		AvgSessionSec:   0,
		Countries:       nil,
		Channels:        nil,
		SocialPlatforms: nil,
		Referrers:       nil,
		UTMCampaigns:    nil,
		LandingPages:    nil,
		Technology:      TrafficTechnology{MobilePct: 0, DesktopPct: 0, TabletPct: 0},
		Notes:           "display_suppressed",
	}
}

func zeroFinanceGeoPayload(label string) FinanceGeoPayload {
	return FinanceGeoPayload{
		Period:   label,
		Notes:    "display_suppressed",
		Rows:     nil,
		Coverage: FinanceGeoCoverage{},
	}
}

func zeroCasinoAnalyticsPayload(start, end time.Time, all bool) map[string]any {
	zbd := map[string]any{
		"settled_bets_minor": int64(0), "settled_wins_minor": int64(0), "total_wagered_minor": int64(0),
		"gross_stake_debit_turnover_minor": int64(0), "ggr": int64(0), "ggr_minor": int64(0),
		"bonus_cost": int64(0), "cashback_paid": int64(0), "rakeback_paid": int64(0), "vip_rewards_paid": int64(0),
		"affiliate_commission": int64(0), "jackpot_costs": int64(0), "payment_provider_fees": int64(0),
		"manual_adjustments": int64(0), "ngr_total": int64(0),
	}
	return map[string]any{
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		"kpis": map[string]any{
			"analytics_schema_version":         AnalyticsSchemaVersion,
			"registrations":                    int64(0),
			"checkout_attempts":                int64(0),
			"settled_deposits":                 int64(0),
			"ftd_count":                        int64(0),
			"reg_to_ftd_conversion_rate":       float64(0),
			"checkout_to_ftd_rate":             float64(0),
			"avg_first_deposit_minor":          int64(0),
			"median_time_to_ftd_hours":         float64(0),
			"repeat_deposit_d7_rate":           float64(0),
			"repeat_deposit_d30_rate":          float64(0),
			"ggr_minor":                        int64(0),
			"ggr_total":                        int64(0),
			"ngr_total":                        int64(0),
			"active_wagering_users":            int64(0),
			"ngr_per_wagering_user":            float64(0),
			"arpu_metric":                      "ngr",
			"bonus_cost_minor":                 int64(0),
			"reward_expense_minor":             int64(0),
			"total_wagered_minor":              int64(0),
			"settled_wager_total":              int64(0),
			"gross_stake_debit_turnover_minor": int64(0),
			"ngr_breakdown":                    zbd,
			"display_suppressed":               true,
		},
		"timeseries":         []map[string]any{},
		"display_suppressed": true,
	}
}

func zeroCryptoChainSummaryMap(start, end time.Time, all bool) map[string]any {
	return map[string]any{
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		"summary": map[string]any{
			"gross_inflow_minor":  int64(0),
			"gross_outflow_minor": int64(0),
			"net_flow_minor":      int64(0),
		},
		"items":              []map[string]any{},
		"display_suppressed": true,
	}
}

func zeroDebugAnalyticsBreakdownMap(start, end time.Time, all bool) map[string]any {
	return map[string]any{
		"analytics_schema_version": AnalyticsSchemaVersion,
		"display_suppressed":       true,
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		"settled_bets": int64(0), "settled_wins": int64(0), "ggr": int64(0),
		"bonus_cost": int64(0), "cashback": int64(0), "rakeback": int64(0), "vip_rewards": int64(0),
		"affiliate_commission": int64(0), "jackpot_cost": int64(0), "payment_fees": int64(0),
		"manual_adjustments": int64(0), "ngr": int64(0),
		"active_wagering_users": int64(0), "arpu": float64(0), "arpu_metric": "ngr",
		"excluded_test_transactions_count": int64(0), "excluded_test_transactions_value": int64(0),
		"excluded_duplicates_count": int64(0), "excluded_rollbacks_count": int64(0),
		"source_tables_used": []string{},
		"cache_status":       "suppressed; no queries run",
		"match_endpoint":     "GET /v1/admin/dashboard/casino-analytics",
	}
}

func zeroNGRBreakdownPayload(start, end time.Time, all bool) map[string]any {
	z := map[string]any{
		"settled_bets_minor": int64(0), "settled_wins_minor": int64(0), "total_wagered_minor": int64(0),
		"gross_stake_debit_turnover_minor": int64(0), "ggr": int64(0), "ggr_minor": int64(0),
		"bonus_cost": int64(0), "cashback_paid": int64(0), "rakeback_paid": int64(0), "vip_rewards_paid": int64(0),
		"affiliate_commission": int64(0), "jackpot_costs": int64(0), "payment_provider_fees": int64(0),
		"manual_adjustments": int64(0), "ngr_total": int64(0),
	}
	return map[string]any{
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		"time_axis":          "ledger_entries.created_at",
		"breakdown":          z,
		"display_suppressed": true,
	}
}

// GetAnalyticsDisplaySuppressed is GET /v1/admin/analytics/display-suppressed
func (h *Handler) GetAnalyticsDisplaySuppressed(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	on := h.dashboardDisplaySuppressed(ctx)
	writeJSON(w, map[string]any{
		"suppressed":      on,
		"suppress_active": on,
		"redis":           h.Redis != nil,
	})
}

type resetDisplayCacheReq struct {
	Resume bool `json:"resume"`
}

// PostAnalyticsResetDisplayCache is POST /v1/admin/analytics/reset-display-cache
// Sets a Redis flag so dashboard/finance analytics endpoints return zeroed derived payloads only (no DB deletes).
func (h *Handler) PostAnalyticsResetDisplayCache(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var body resetDisplayCacheReq
	_ = json.NewDecoder(r.Body).Decode(&body)

	cleared := []string{}
	clientFallback := false

	if body.Resume {
		if h.Redis != nil {
			n, err := h.Redis.Del(ctx, redisKeyAdminDashboardSuppressDisplay).Result()
			if err != nil {
				adminapi.WriteError(w, http.StatusInternalServerError, "redis_error", err.Error())
				return
			}
			if n > 0 {
				cleared = append(cleared, redisKeyAdminDashboardSuppressDisplay)
			}
		}
		keys, err := h.redisDeleteDashboardDisplayCacheKeys(ctx)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "redis_error", err.Error())
			return
		}
		cleared = append(cleared, keys...)
		writeJSON(w, map[string]any{
			"ok":                 true,
			"suppress_active":    false,
			"cleared":            cleared,
			"client_fallback":    false,
			"source_tables_note": "ledger and payment tables were not modified",
		})
		return
	}

	if h.Redis != nil {
		if err := h.Redis.Set(ctx, redisKeyAdminDashboardSuppressDisplay, "1", 0).Err(); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "redis_error", err.Error())
			return
		}
		cleared = append(cleared, "set:"+redisKeyAdminDashboardSuppressDisplay)
		keys, err := h.redisDeleteDashboardDisplayCacheKeys(ctx)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "redis_error", err.Error())
			return
		}
		cleared = append(cleared, keys...)
	} else {
		clientFallback = true
		cleared = append(cleared, "note:no_redis_server_flag_skipped_use_admin_console_client_fallback")
	}

	writeJSON(w, map[string]any{
		"ok":                 true,
		"suppress_active":    h.dashboardDisplaySuppressed(ctx),
		"cleared":            cleared,
		"client_fallback":    clientFallback,
		"source_tables_note": "ledger, users, payments, bonuses, withdrawals, audit logs unchanged",
	})
}
