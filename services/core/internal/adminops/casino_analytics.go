package adminops

import (
	"context"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
)

func parseAnalyticsWindow(r *http.Request) (time.Time, time.Time, bool, error) {
	now := time.Now().UTC()
	q := r.URL.Query()
	startRaw := q.Get("start")
	endRaw := q.Get("end")
	if startRaw != "" || endRaw != "" {
		start, err := parseFlexibleTime(startRaw, true)
		if err != nil {
			return time.Time{}, time.Time{}, false, err
		}
		end, err := parseFlexibleTime(endRaw, false)
		if err != nil {
			return time.Time{}, time.Time{}, false, err
		}
		if end.IsZero() {
			end = now
		}
		if start.IsZero() {
			start = end.AddDate(0, 0, -30)
		}
		if end.Before(start) {
			return time.Time{}, time.Time{}, false, errInvalidRange
		}
		return start, end, false, nil
	}

	switch q.Get("period") {
	case "7d":
		return now.AddDate(0, 0, -7), now, false, nil
	case "90d":
		return now.AddDate(0, 0, -90), now, false, nil
	case "6m":
		return now.AddDate(0, -6, 0), now, false, nil
	case "ytd":
		return time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC), now, false, nil
	case "all":
		return time.Time{}, now, true, nil
	default:
		return now.AddDate(0, 0, -30), now, false, nil
	}
}

var errInvalidRange = &adminErr{code: "invalid_request", message: "invalid timeframe range"}

type adminErr struct {
	code    string
	message string
}

func (e *adminErr) Error() string { return e.message }

func parseFlexibleTime(raw string, startOfDay bool) (time.Time, error) {
	if raw == "" {
		return time.Time{}, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC(), nil
	}
	if d, err := time.Parse("2006-01-02", raw); err == nil {
		if startOfDay {
			return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC), nil
		}
		return time.Date(d.Year(), d.Month(), d.Day(), 23, 59, 59, int(time.Second-time.Nanosecond), time.UTC), nil
	}
	return time.Time{}, errInvalidRange
}

func (h *Handler) DashboardCasinoAnalytics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, all, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	var (
		registrations, checkoutAttempts, settledDeposits int64
		ftdCount, redepositD7, redepositD30              int64
		avgFirstDepositMinor                             int64
		medianTTFDHours                                  float64
		ggrMinor, bonusCostMinor, rewardCostMinor        int64
	)

	windowClause := "created_at >= $1 AND created_at <= $2"
	args := []any{start, end}
	if all {
		windowClause = "created_at <= $1"
		args = []any{end}
	}

	q := `
WITH user_window AS (
	SELECT id, created_at
	FROM users
	WHERE ` + windowClause + `
),
checkouts_window AS (
	SELECT c.user_id, c.created_at
	FROM payment_deposit_intents c
	WHERE c.provider = 'passimpay' AND ` + windowClause + `
),
ledger_credits AS (
	SELECT le.user_id, le.created_at, le.amount_minor
	FROM ledger_entries le
	WHERE le.entry_type = 'deposit.credit' AND le.amount_minor > 0
),
first_deposit AS (
	SELECT DISTINCT ON (lc.user_id) lc.user_id, lc.created_at AS first_at, lc.amount_minor
	FROM ledger_credits lc
	ORDER BY lc.user_id, lc.created_at ASC
),
first_in_window AS (
	SELECT fd.user_id, fd.first_at, fd.amount_minor, u.created_at AS reg_at
	FROM first_deposit fd
	JOIN user_window u ON u.id = fd.user_id
		WHERE fd.first_at <= $` + paramIdx(all) + `
		AND fd.first_at >= u.created_at
),
repeat_stats AS (
	SELECT
		COUNT(DISTINCT CASE WHEN lc.created_at > fiw.first_at AND lc.created_at <= fiw.first_at + interval '7 days' THEN lc.user_id END) AS rep_d7,
		COUNT(DISTINCT CASE WHEN lc.created_at > fiw.first_at AND lc.created_at <= fiw.first_at + interval '30 days' THEN lc.user_id END) AS rep_d30
	FROM first_in_window fiw
	LEFT JOIN ledger_credits lc ON lc.user_id = fiw.user_id
)
SELECT
	(SELECT COUNT(*) FROM user_window),
	(SELECT COUNT(*) FROM checkouts_window),
	(SELECT COUNT(*) FROM ledger_credits sp WHERE ` + clauseWithAlias(all, "sp", start, end) + `),
	(SELECT COUNT(*) FROM first_in_window),
	COALESCE((SELECT AVG(fiw.amount_minor)::bigint FROM first_in_window fiw), 0),
	COALESCE((SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fiw.first_at - fiw.reg_at))/3600.0) FROM first_in_window fiw), 0),
	(SELECT rep_d7 FROM repeat_stats),
	(SELECT rep_d30 FROM repeat_stats),
	COALESCE((SELECT
		SUM(CASE WHEN entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(amount_minor) WHEN entry_type IN ('game.rollback','sportsbook.rollback') THEN -ABS(amount_minor) ELSE 0 END) -
		SUM(CASE WHEN entry_type IN ('game.credit','game.win','game.win_rollback','sportsbook.credit') THEN amount_minor ELSE 0 END)
		FROM ledger_entries le
		WHERE le.entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback','game.win_rollback','sportsbook.debit','sportsbook.credit','sportsbook.rollback') AND ` + clauseWithAlias(all, "le", start, end) + `), 0),
	COALESCE((SELECT SUM(amount_minor) FROM ledger_entries ubi
		WHERE ubi.entry_type = 'promo.grant' AND ubi.pocket = 'bonus_locked' AND ubi.amount_minor > 0 AND ` + clauseWithAlias(all, "ubi", start, end) + `), 0),
	COALESCE((SELECT SUM(amount_minor) FROM ledger_entries re
		WHERE re.entry_type IN ('promo.rakeback','vip.level_up_cash','promo.daily_hunt_cash') AND re.amount_minor > 0 AND re.pocket = 'cash' AND ` + clauseWithAlias(all, "re", start, end) + `), 0)
`

	if err := h.Pool.QueryRow(ctx, q, args...).Scan(
		&registrations, &checkoutAttempts, &settledDeposits, &ftdCount,
		&avgFirstDepositMinor, &medianTTFDHours, &redepositD7, &redepositD30,
		&ggrMinor, &bonusCostMinor, &rewardCostMinor,
	); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "casino analytics query failed")
		return
	}

	regToFTD := 0.0
	if registrations > 0 {
		regToFTD = float64(ftdCount) / float64(registrations) * 100
	}
	checkoutToFTD := 0.0
	if checkoutAttempts > 0 {
		checkoutToFTD = float64(ftdCount) / float64(checkoutAttempts) * 100
	}
	repeatD7Rate := 0.0
	repeatD30Rate := 0.0
	if ftdCount > 0 {
		repeatD7Rate = float64(redepositD7) / float64(ftdCount) * 100
		repeatD30Rate = float64(redepositD30) / float64(ftdCount) * 100
	}

	series, err := h.casinoAnalyticsSeries(ctx, start, end, all)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "casino analytics series failed")
		return
	}

	writeJSON(w, map[string]any{
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		"kpis": map[string]any{
			"registrations":              registrations,
			"checkout_attempts":          checkoutAttempts,
			"settled_deposits":           settledDeposits,
			"ftd_count":                  ftdCount,
			"reg_to_ftd_conversion_rate": regToFTD,
			"checkout_to_ftd_rate":       checkoutToFTD,
			"avg_first_deposit_minor":    avgFirstDepositMinor,
			"median_time_to_ftd_hours":   medianTTFDHours,
			"repeat_deposit_d7_rate":     repeatD7Rate,
			"repeat_deposit_d30_rate":    repeatD30Rate,
			"ggr_minor":                  ggrMinor,
			"ngr_proxy_minor":            ggrMinor - bonusCostMinor - rewardCostMinor,
			"bonus_cost_minor":           bonusCostMinor,
			"reward_expense_minor":       rewardCostMinor,
		},
		"timeseries": series,
	})
}

func (h *Handler) casinoAnalyticsSeries(ctx context.Context, start, end time.Time, _ bool) ([]map[string]any, error) {
	rows, err := h.Pool.Query(ctx, `
WITH daily AS (
	SELECT date_trunc('day', u.created_at)::date AS d,
		COUNT(*)::bigint AS registrations
	FROM users u
	WHERE u.created_at >= $1 AND u.created_at <= $2
	GROUP BY 1
),
ftd AS (
	SELECT date_trunc('day', first_at)::date AS d, COUNT(*)::bigint AS ftd_count
	FROM (
		SELECT DISTINCT ON (le.user_id) le.user_id, le.created_at AS first_at
		FROM ledger_entries le
		WHERE le.entry_type = 'deposit.credit' AND le.amount_minor > 0 AND le.created_at <= $2
		ORDER BY le.user_id, le.created_at ASC
	) x
	WHERE x.first_at >= $1
	GROUP BY 1
)
SELECT COALESCE(daily.d, ftd.d) AS d,
	COALESCE(daily.registrations,0),
	COALESCE(ftd.ftd_count,0)
FROM daily
FULL OUTER JOIN ftd ON ftd.d = daily.d
ORDER BY d
`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var d time.Time
		var reg, ftd int64
		if err := rows.Scan(&d, &reg, &ftd); err != nil {
			continue
		}
		rate := 0.0
		if reg > 0 {
			rate = float64(ftd) / float64(reg) * 100
		}
		out = append(out, map[string]any{
			"date":           d.Format("2006-01-02"),
			"registrations":  reg,
			"ftd_count":      ftd,
			"ftd_conversion": rate,
		})
	}
	return out, nil
}

func (h *Handler) DashboardCryptoChainSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, all, err := parseAnalyticsWindow(r)
	args := []any{start, end}
	if all {
		args = []any{end}
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	q := `
WITH dep AS (
	SELECT
		COALESCE(NULLIF(le.metadata->>'network',''), NULLIF(le.metadata->>'chain',''), le.currency, 'unknown') AS chain,
		COALESCE(le.currency, 'unknown') AS asset,
		COUNT(*)::bigint AS dep_count,
		COUNT(DISTINCT le.user_id)::bigint AS dep_users,
		SUM(COALESCE(le.amount_minor,0))::bigint AS dep_volume_minor
	FROM ledger_entries le
	WHERE le.entry_type = 'deposit.credit' AND le.amount_minor > 0
	  AND ` + clauseWithAlias(all, "le", start, end) + `
	GROUP BY 1,2
),
wd AS (
	SELECT
		COALESCE(NULLIF(w.network,''), w.currency, 'unknown') AS chain,
		COALESCE(w.currency, 'unknown') AS asset,
		COUNT(*)::bigint AS wd_count,
		COUNT(DISTINCT w.user_id)::bigint AS wd_users,
		SUM(COALESCE(w.amount_minor,0))::bigint AS wd_volume_minor
	FROM payment_withdrawals w
	WHERE w.provider = 'passimpay' AND w.status <> 'FAILED' AND ` + clauseWithAlias(all, "w", start, end) + `
	GROUP BY 1,2
)
SELECT
	COALESCE(dep.chain, wd.chain) AS chain,
	COALESCE(dep.asset, wd.asset) AS asset,
	COALESCE(dep.dep_count,0),
	COALESCE(dep.dep_users,0),
	COALESCE(dep.dep_volume_minor,0),
	COALESCE(wd.wd_count,0),
	COALESCE(wd.wd_users,0),
	COALESCE(wd.wd_volume_minor,0)
FROM dep
FULL OUTER JOIN wd ON wd.chain = dep.chain AND wd.asset = dep.asset
ORDER BY 1,2
`

	rows, err := h.Pool.Query(ctx, q, args...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "crypto summary query failed")
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	var totalIn, totalOut int64
	for rows.Next() {
		var chain, asset string
		var depCount, depUsers, depVol, wdCount, wdUsers, wdVol int64
		if err := rows.Scan(&chain, &asset, &depCount, &depUsers, &depVol, &wdCount, &wdUsers, &wdVol); err != nil {
			continue
		}
		totalIn += depVol
		totalOut += wdVol
		successRate := 100.0
		if depCount+wdCount == 0 {
			successRate = 0
		}
		items = append(items, map[string]any{
			"chain":                   chain,
			"asset":                   asset,
			"deposit_count":           depCount,
			"deposit_users":           depUsers,
			"deposit_volume_minor":    depVol,
			"withdrawal_count":        wdCount,
			"withdrawal_users":        wdUsers,
			"withdrawal_volume_minor": wdVol,
			"net_flow_minor":          depVol - wdVol,
			"success_rate":            successRate,
		})
	}

	writeJSON(w, map[string]any{
		"window": map[string]any{
			"start":    start.Format(time.RFC3339),
			"end":      end.Format(time.RFC3339),
			"all_time": all,
		},
		"summary": map[string]any{
			"gross_inflow_minor":  totalIn,
			"gross_outflow_minor": totalOut,
			"net_flow_minor":      totalIn - totalOut,
		},
		"items": items,
	})
}

func clauseWithAlias(all bool, alias string, _ time.Time, _ time.Time) string {
	if all {
		return alias + ".created_at <= $1"
	}
	return alias + ".created_at >= $1 AND " + alias + ".created_at <= $2"
}

func paramIdx(all bool) string {
	if all {
		return "1"
	}
	return "2"
}
