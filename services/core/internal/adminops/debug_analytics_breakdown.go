package adminops

import (
	"net/http"
	"strconv"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
)

// AnalyticsSchemaVersion is bumped when casino-analytics / dashboard NGR semantics change.
const AnalyticsSchemaVersion int64 = 2

// DebugAnalyticsBreakdown returns the same ledger-backed figures as GET /dashboard/casino-analytics KPIs,
// plus exclusion diagnostics. Use query period= or range= (alias) plus optional start/end like casino analytics.
func (h *Handler) DebugAnalyticsBreakdown(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, all, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	w.Header().Set("X-Analytics-Schema-Version", strconv.FormatInt(AnalyticsSchemaVersion, 10))

	b, err := queryDashboardNGRBreakdown(ctx, h.Pool, start, end, all)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	active, err := queryActiveWageringUsers(ctx, h.Pool, start, end, all)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	ngr := ngrTotalFromBreakdown(b)
	useGGR := h.Cfg != nil && h.Cfg.CasinoAnalyticsARPUUseGGR
	arpu := arpuPerWageringUserMinor(useGGR, b.GGR, ngr, active)
	arpuMetric := "ngr"
	if useGGR {
		arpuMetric = "ggr"
	}

	win := clauseWithAlias(all, "le", start, end)
	ngrF := ledger.NGRReportingFilterSQL("le")

	var testCount int64
	var testAbsMinor int64
	var debitResetCount int64
	var excludedUserCount int64
	var excludedUserAbsMinor int64
	var rollbackCount int64
	qEx := `
SELECT
  COALESCE(COUNT(*) FILTER (WHERE le.entry_type = 'test.seed'), 0),
  COALESCE(SUM(ABS(le.amount_minor)) FILTER (WHERE le.entry_type = 'test.seed'), 0)::bigint,
  COALESCE(COUNT(*) FILTER (WHERE le.entry_type = 'game.credit' AND le.idempotency_key LIKE '%:debit_reset:%'), 0),
  COALESCE(COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM users u WHERE u.id = le.user_id AND COALESCE(u.exclude_from_dashboard_analytics, false)
    ) AND le.entry_type <> 'provider.fee'), 0),
  COALESCE(SUM(ABS(le.amount_minor)) FILTER (WHERE EXISTS (
      SELECT 1 FROM users u WHERE u.id = le.user_id AND COALESCE(u.exclude_from_dashboard_analytics, false)
    ) AND le.entry_type <> 'provider.fee'), 0)::bigint,
  COALESCE(COUNT(*) FILTER (WHERE le.entry_type IN ('game.rollback','sportsbook.rollback')), 0)
FROM ledger_entries le
WHERE ` + win
	args := []any{start, end}
	if all {
		args = []any{end}
	}
	if err := h.Pool.QueryRow(ctx, qEx, args...).Scan(
		&testCount, &testAbsMinor, &debitResetCount, &excludedUserCount, &excludedUserAbsMinor, &rollbackCount,
	); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	var dupGroups int64
	qDup := `
SELECT COUNT(*)::bigint FROM (
  SELECT le.idempotency_key
  FROM ledger_entries le
  WHERE ` + win + ` AND ` + ngrF + ` AND COALESCE(le.idempotency_key, '') <> ''
  GROUP BY le.idempotency_key
  HAVING COUNT(*) > 1
) t`
	if err := h.Pool.QueryRow(ctx, qDup, args...).Scan(&dupGroups); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	writeJSON(w, map[string]any{
		"analytics_schema_version": AnalyticsSchemaVersion,
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		// Flat names (values are minor currency units unless noted).
		"settled_bets":                          b.SettledBetsMinor,
		"settled_wins":                          b.SettledWinsMinor,
		"ggr":                                   b.GGR,
		"bonus_cost":                            b.BonusCost,
		"cashback":                              b.CashbackPaid,
		"rakeback":                              b.RakebackPaid,
		"vip_rewards":                           b.VipRewardsPaid,
		"affiliate_commission":                  b.AffiliateCommission,
		"jackpot_cost":                          b.JackpotCosts,
		"payment_fees":                          b.PaymentProviderFees,
		"manual_adjustments":                    b.ManualAdjustments,
		"ngr":                                   ngr,
		"active_wagering_users":                 active,
		"arpu":                                  arpu,
		"arpu_metric":                           arpuMetric,
		"settled_bets_minor":                    b.SettledBetsMinor,
		"settled_wins_minor":                    b.SettledWinsMinor,
		"ggr_minor":                             b.GGR,
		"ggr_total":                             b.GGR,
		"bonus_cost_minor":                      b.BonusCost,
		"cashback_minor":                        b.CashbackPaid,
		"rakeback_minor":                        b.RakebackPaid,
		"vip_rewards_minor":                     b.VipRewardsPaid,
		"affiliate_commission_minor":            b.AffiliateCommission,
		"jackpot_cost_minor":                    b.JackpotCosts,
		"payment_fees_minor":                    b.PaymentProviderFees,
		"manual_adjustments_minor":              b.ManualAdjustments,
		"ngr_minor":                             ngr,
		"ngr_total":                             ngr,
		"total_wagered_minor":                   b.SettledBetsMinor,
		"settled_wager_total":                   b.SettledBetsMinor,
		"ngr_per_wagering_user":                 arpu,
		"gross_stake_debit_turnover_minor":      b.TotalWageredDebitMinor,
		"excluded_test_transactions_count":      testCount,
		"excluded_test_transactions_value":      testAbsMinor,
		"excluded_test_transactions_abs_minor":  testAbsMinor,
		"excluded_debit_reset_credit_lines":     debitResetCount,
		"excluded_analytics_user_lines":         excludedUserCount,
		"excluded_analytics_user_abs_minor":     excludedUserAbsMinor,
		"rollback_lines_in_window":              rollbackCount,
		"excluded_duplicates_count":             dupGroups,
		"excluded_duplicate_idempotency_groups": dupGroups,
		"excluded_rollbacks_count":              rollbackCount,
		"source_tables_used": []string{
			"ledger_entries",
			"users (exclude_from_dashboard_analytics)",
			"reward_programs (promo.rakeback splits)",
		},
		"cache_status":   "none; figures computed on request from ledger (no materialized KPI table in this service)",
		"match_endpoint": "GET /v1/admin/dashboard/casino-analytics (same window + parseAnalyticsWindow; use period= or range=)",
	})
}
