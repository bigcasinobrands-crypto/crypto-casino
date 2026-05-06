package adminops

import (
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/go-chi/chi/v5"
)

func parsePeriodDays(s string) int {
	switch s {
	case "7d":
		return 7
	case "90d":
		return 90
	default:
		return 30
	}
}

func (h *Handler) DashboardKPIs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var (
		ggr24h, ggr7d, ggr30d, ggrAll  int64
		totalWagered24h, totalWagered7d, totalWagered30d, totalWageredAll int64
		dep24h, dep7d, dep30d          int64
		depCnt24h, depCnt7d, depCnt30d int64
		wd24h, wd7d, wd30d             int64
		wdCnt24h, wdCnt7d, wdCnt30d    int64
		active24h, active7d, active30d int64
		reg24h, reg7d, reg30d          int64
		bonus24h, bonus7d, bonus30d    int64
		reward24h, reward7d, reward30d int64
		pendWdVal, pendWdCnt           int64
		totalUsers, usersWithDeposit   int64
		avgDepSize30d                  int64
	)
	err := h.Pool.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END)
				- SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END)
				FROM ledger_entries WHERE entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')
				AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END)
				- SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END)
				FROM ledger_entries WHERE entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')
				AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END)
				- SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END)
				FROM ledger_entries WHERE entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')
				AND created_at > now()-interval '30 days'), 0),
			COALESCE((SELECT SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END)
				- SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END)
				FROM ledger_entries WHERE entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')), 0),

			COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
				WHERE entry_type IN ('game.debit','game.bet')
				AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
				WHERE entry_type IN ('game.debit','game.bet')
				AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
				WHERE entry_type IN ('game.debit','game.bet')
				AND created_at > now()-interval '30 days'), 0),
			COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
				WHERE entry_type IN ('game.debit','game.bet')), 0),

			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
				AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
				AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
				AND created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT COUNT(*) FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
				AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT COUNT(*) FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
				AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT COUNT(*) FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
				AND created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
				WHERE entry_type = 'withdrawal.debit' AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
				WHERE entry_type = 'withdrawal.debit' AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT SUM(ABS(amount_minor)) FROM ledger_entries
				WHERE entry_type = 'withdrawal.debit' AND created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT COUNT(*) FROM ledger_entries
				WHERE entry_type = 'withdrawal.debit' AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT COUNT(*) FROM ledger_entries
				WHERE entry_type = 'withdrawal.debit' AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT COUNT(*) FROM ledger_entries
				WHERE entry_type = 'withdrawal.debit' AND created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT COUNT(DISTINCT user_id) FROM ledger_entries
				WHERE entry_type = 'game.debit' AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT COUNT(DISTINCT user_id) FROM ledger_entries
				WHERE entry_type = 'game.debit' AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT COUNT(DISTINCT user_id) FROM ledger_entries
				WHERE entry_type = 'game.debit' AND created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT COUNT(*) FROM users WHERE created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT COUNT(*) FROM users WHERE created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT COUNT(*) FROM users WHERE created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type = 'promo.grant' AND pocket = 'bonus_locked' AND amount_minor > 0
				AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type = 'promo.grant' AND pocket = 'bonus_locked' AND amount_minor > 0
				AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type = 'promo.grant' AND pocket = 'bonus_locked' AND amount_minor > 0
				AND created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type IN ('promo.rakeback','vip.level_up_cash','promo.daily_hunt_cash') AND amount_minor > 0 AND pocket = 'cash'
				AND created_at > now()-interval '24 hours'), 0),
			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type IN ('promo.rakeback','vip.level_up_cash','promo.daily_hunt_cash') AND amount_minor > 0 AND pocket = 'cash'
				AND created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
				WHERE entry_type IN ('promo.rakeback','vip.level_up_cash','promo.daily_hunt_cash') AND amount_minor > 0 AND pocket = 'cash'
				AND created_at > now()-interval '30 days'), 0),

			COALESCE((SELECT SUM(COALESCE(amount_minor,0)) FROM payment_withdrawals
				WHERE provider='passimpay' AND status IN ('LEDGER_LOCKED','SUBMITTED_TO_PROVIDER')), 0),
			COALESCE((SELECT COUNT(*) FROM payment_withdrawals
				WHERE provider='passimpay' AND status IN ('LEDGER_LOCKED','SUBMITTED_TO_PROVIDER')), 0),

			COALESCE((SELECT COUNT(*) FROM users), 0),
			COALESCE((SELECT COUNT(DISTINCT user_id) FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0), 0),

			COALESCE((SELECT AVG(amount_minor)::bigint FROM ledger_entries
				WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
				AND created_at > now()-interval '30 days'), 0)
	`).Scan(
		&ggr24h, &ggr7d, &ggr30d, &ggrAll,
		&totalWagered24h, &totalWagered7d, &totalWagered30d, &totalWageredAll,
		&dep24h, &dep7d, &dep30d,
		&depCnt24h, &depCnt7d, &depCnt30d,
		&wd24h, &wd7d, &wd30d,
		&wdCnt24h, &wdCnt7d, &wdCnt30d,
		&active24h, &active7d, &active30d,
		&reg24h, &reg7d, &reg30d,
		&bonus24h, &bonus7d, &bonus30d,
		&reward24h, &reward7d, &reward30d,
		&pendWdVal, &pendWdCnt,
		&totalUsers, &usersWithDeposit,
		&avgDepSize30d,
	)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "kpi query failed")
		return
	}

	ngr24h := ggr24h - bonus24h - reward24h
	ngr7d := ggr7d - bonus7d - reward7d
	ngr30d := ggr30d - bonus30d - reward30d

	var arpu7d float64
	if active7d > 0 {
		arpu7d = float64(ngr7d) / float64(active7d)
	}
	var depositConvRate float64
	if totalUsers > 0 {
		depositConvRate = float64(usersWithDeposit) / float64(totalUsers) * 100
	}

	writeJSON(w, map[string]any{
		"ggr_24h": ggr24h, "ggr_7d": ggr7d, "ggr_30d": ggr30d, "ggr_all": ggrAll,
		"total_wagered_24h": totalWagered24h, "total_wagered_7d": totalWagered7d,
		"total_wagered_30d": totalWagered30d, "total_wagered_all": totalWageredAll,
		"deposits_24h": dep24h, "deposits_7d": dep7d, "deposits_30d": dep30d,
		"deposits_count_24h": depCnt24h, "deposits_count_7d": depCnt7d, "deposits_count_30d": depCnt30d,
		"withdrawals_24h": wd24h, "withdrawals_7d": wd7d, "withdrawals_30d": wd30d,
		"withdrawals_count_24h": wdCnt24h, "withdrawals_count_7d": wdCnt7d, "withdrawals_count_30d": wdCnt30d,
		"net_cash_flow_30d":  dep30d - wd30d,
		"active_players_24h": active24h, "active_players_7d": active7d, "active_players_30d": active30d,
		"new_registrations_24h": reg24h, "new_registrations_7d": reg7d, "new_registrations_30d": reg30d,
		"bonus_cost_24h": bonus24h, "bonus_cost_7d": bonus7d, "bonus_cost_30d": bonus30d,
		"reward_expense_24h": reward24h, "reward_expense_7d": reward7d, "reward_expense_30d": reward30d,
		"ngr_24h": ngr24h, "ngr_7d": ngr7d, "ngr_30d": ngr30d,
		"arpu_7d":                   arpu7d,
		"avg_deposit_size_30d":      avgDepSize30d,
		"deposit_conversion_rate":   depositConvRate,
		"pending_withdrawals_value": pendWdVal,
		"pending_withdrawals_count": pendWdCnt,
		"metrics_derivation": map[string]string{
			"deposits":       "ledger_entries: deposit.credit, deposit.checkout (amount_minor > 0)",
			"ggr":            "ledger_entries: game.debit/bet/credit/win/rollback",
			"total_wagered":  "ledger_entries: sum ABS(stake) on game.debit + game.bet (includes cash+bonus stake lines)",
			"bonus_cost":     "ledger_entries: promo.grant to bonus_locked pocket",
			"reward_expense": "ledger_entries: promo.rakeback, vip.level_up_cash, promo.daily_hunt_cash (cash pocket)",
			"ngr":            "GGR - bonus grant expense - cash reward expense (period); affiliate/provider fees in phase 2",
			"active_players": "distinct user_id with game.debit in window (ledger-backed wagering)",
			"pending_wd":     "payment_withdrawals (PassimPay) in LEDGER_LOCKED / SUBMITTED_TO_PROVIDER",
		},
	})
}

func (h *Handler) DashboardCharts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	start, end, _, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "invalid timeframe")
		return
	}

	depByDay := make([]map[string]any, 0)
	depRows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date, COALESCE(SUM(COALESCE(amount_minor,0)),0), COUNT(*)
		FROM ledger_entries
		WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
		  AND created_at >= $1 AND created_at <= $2
		GROUP BY 1 ORDER BY 1`, start, end)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "charts query failed")
		return
	}
	for depRows.Next() {
		var d time.Time
		var total, count int64
		if err := depRows.Scan(&d, &total, &count); err != nil {
			continue
		}
		depByDay = append(depByDay, map[string]any{"date": d.Format("2006-01-02"), "total_minor": total, "count": count})
	}
	depRows.Close()

	wdByDay := make([]map[string]any, 0)
	wdRows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date, COALESCE(SUM(ABS(amount_minor)),0), COUNT(*)
		FROM ledger_entries
		WHERE entry_type = 'withdrawal.debit' AND created_at >= $1 AND created_at <= $2
		GROUP BY 1 ORDER BY 1`, start, end)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "charts query failed")
		return
	}
	for wdRows.Next() {
		var d time.Time
		var total, count int64
		if err := wdRows.Scan(&d, &total, &count); err != nil {
			continue
		}
		wdByDay = append(wdByDay, map[string]any{"date": d.Format("2006-01-02"), "total_minor": total, "count": count})
	}
	wdRows.Close()

	ggrByDay := make([]map[string]any, 0)
	ggrRows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date,
			COALESCE(SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END), 0)
		FROM ledger_entries WHERE entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')
		AND created_at >= $1 AND created_at <= $2
		GROUP BY 1 ORDER BY 1`, start, end)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "charts query failed")
		return
	}
	for ggrRows.Next() {
		var d time.Time
		var bets, wins int64
		if err := ggrRows.Scan(&d, &bets, &wins); err != nil {
			continue
		}
		ggrByDay = append(ggrByDay, map[string]any{
			"date": d.Format("2006-01-02"), "bets_minor": bets, "wins_minor": wins, "ggr_minor": bets - wins,
		})
	}
	ggrRows.Close()

	regByDay := make([]map[string]any, 0)
	regRows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date, COUNT(*)
		FROM users WHERE created_at >= $1 AND created_at <= $2
		GROUP BY 1 ORDER BY 1`, start, end)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "charts query failed")
		return
	}
	for regRows.Next() {
		var d time.Time
		var count int64
		if err := regRows.Scan(&d, &count); err != nil {
			continue
		}
		regByDay = append(regByDay, map[string]any{"date": d.Format("2006-01-02"), "count": count})
	}
	regRows.Close()

	launchByDay := make([]map[string]any, 0)
	launchRows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date, COUNT(*)
		FROM game_launches WHERE created_at >= $1 AND created_at <= $2
		GROUP BY 1 ORDER BY 1`, start, end)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "charts query failed")
		return
	}
	for launchRows.Next() {
		var d time.Time
		var count int64
		if err := launchRows.Scan(&d, &count); err != nil {
			continue
		}
		launchByDay = append(launchByDay, map[string]any{"date": d.Format("2006-01-02"), "count": count})
	}
	launchRows.Close()

	bonusByDay := make([]map[string]any, 0)
	bonusRows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date, COALESCE(SUM(COALESCE(granted_amount_minor,0)),0), COUNT(*)
		FROM user_bonus_instances WHERE created_at >= $1 AND created_at <= $2
		GROUP BY 1 ORDER BY 1`, start, end)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "charts query failed")
		return
	}
	for bonusRows.Next() {
		var d time.Time
		var total, count int64
		if err := bonusRows.Scan(&d, &total, &count); err != nil {
			continue
		}
		bonusByDay = append(bonusByDay, map[string]any{"date": d.Format("2006-01-02"), "total_minor": total, "count": count})
	}
	bonusRows.Close()

	writeJSON(w, map[string]any{
		"deposits_by_day":      depByDay,
		"withdrawals_by_day":   wdByDay,
		"ggr_by_day":           ggrByDay,
		"registrations_by_day": regByDay,
		"game_launches_by_day": launchByDay,
		"bonus_grants_by_day":  bonusByDay,
	})
}

func (h *Handler) DashboardTopGames(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	limit := parseLimit(r.URL.Query().Get("limit"), 10)
	if limit > 50 {
		limit = 50
	}
	start, end, _, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "invalid timeframe")
		return
	}

	topByLaunches := make([]map[string]any, 0)
	rows, err := h.Pool.Query(ctx, `
		SELECT g.id, g.title, g.provider, COUNT(*) AS launch_count
		FROM game_launches gl JOIN games g ON g.id = gl.game_id
		WHERE gl.created_at >= $1 AND gl.created_at <= $2
		GROUP BY g.id, g.title, g.provider
		ORDER BY launch_count DESC LIMIT $3`, start, end, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "top games query failed")
		return
	}
	for rows.Next() {
		var id, title, provider string
		var launches int64
		if err := rows.Scan(&id, &title, &provider, &launches); err != nil {
			continue
		}
		topByLaunches = append(topByLaunches, map[string]any{
			"id": id, "title": title, "provider_key": provider, "launch_count": launches,
		})
	}
	rows.Close()

	topByGGR := make([]map[string]any, 0)
	ggrRows, err := h.Pool.Query(ctx, `
		SELECT g.id, g.title, g.provider,
			COALESCE(SUM(CASE WHEN le.entry_type IN ('game.debit','game.bet') THEN ABS(le.amount_minor) WHEN le.entry_type = 'game.rollback' THEN -ABS(le.amount_minor) ELSE 0 END), 0) AS total_bets,
			COALESCE(SUM(CASE WHEN le.entry_type IN ('game.credit','game.win') THEN le.amount_minor ELSE 0 END), 0) AS total_wins
		FROM ledger_entries le
		JOIN games g ON g.id = le.metadata->>'game_id'
		WHERE le.entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')
			AND le.metadata->>'game_id' IS NOT NULL
			AND le.created_at >= $1 AND le.created_at <= $2
		GROUP BY g.id, g.title, g.provider
		ORDER BY (COALESCE(SUM(CASE WHEN le.entry_type IN ('game.debit','game.bet') THEN ABS(le.amount_minor) WHEN le.entry_type = 'game.rollback' THEN -ABS(le.amount_minor) ELSE 0 END),0)
			- COALESCE(SUM(CASE WHEN le.entry_type IN ('game.credit','game.win') THEN le.amount_minor ELSE 0 END),0)) DESC
		LIMIT $3`, start, end, limit)
	if err == nil {
		for ggrRows.Next() {
			var id, title, provider string
			var bets, wins int64
			if err := ggrRows.Scan(&id, &title, &provider, &bets, &wins); err != nil {
				continue
			}
			ggr := bets - wins
			var rtpPct float64
			if bets > 0 {
				rtpPct = float64(wins) / float64(bets) * 100
			}
			topByGGR = append(topByGGR, map[string]any{
				"id": id, "title": title, "provider_key": provider,
				"total_bets_minor": bets, "total_wins_minor": wins,
				"ggr_minor": ggr, "rtp_pct": rtpPct,
			})
		}
		ggrRows.Close()
	}

	writeJSON(w, map[string]any{
		"top_by_launches": topByLaunches,
		"top_by_ggr":      topByGGR,
	})
}

func (h *Handler) DashboardPlayerStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var totalReg, totalWithDep, active7d, active30d int64
	err := h.Pool.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT COUNT(*) FROM users), 0),
			COALESCE((SELECT COUNT(DISTINCT user_id) FROM ledger_entries WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0), 0),
			COALESCE((SELECT COUNT(DISTINCT user_id) FROM game_launches WHERE created_at > now()-interval '7 days'), 0),
			COALESCE((SELECT COUNT(DISTINCT user_id) FROM game_launches WHERE created_at > now()-interval '30 days'), 0)
	`).Scan(&totalReg, &totalWithDep, &active7d, &active30d)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "player stats query failed")
		return
	}

	var depositConvRate float64
	if totalReg > 0 {
		depositConvRate = float64(totalWithDep) / float64(totalReg) * 100
	}

	var avgLTV int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(dep_total - COALESCE(wd_total, 0))::bigint, 0) FROM (
			SELECT user_id, SUM(COALESCE(amount_minor,0)) AS dep_total
			FROM ledger_entries
			WHERE entry_type IN ('deposit.credit','deposit.checkout') AND amount_minor > 0
			GROUP BY user_id
		) dep LEFT JOIN (
			SELECT user_id, SUM(ABS(amount_minor)) AS wd_total
			FROM ledger_entries WHERE entry_type = 'withdrawal.debit'
			GROUP BY user_id
		) wd ON wd.user_id = dep.user_id
	`).Scan(&avgLTV)

	topDepositors := make([]map[string]any, 0)
	depRows, err := h.Pool.Query(ctx, `
		SELECT u.id::text, u.email, COALESCE(SUM(COALESCE(le.amount_minor,0)),0) AS total
		FROM ledger_entries le JOIN users u ON u.id = le.user_id
		WHERE le.entry_type IN ('deposit.credit','deposit.checkout') AND le.amount_minor > 0
		GROUP BY u.id, u.email ORDER BY total DESC LIMIT 10`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "top depositors query failed")
		return
	}
	for depRows.Next() {
		var id, email string
		var total int64
		if err := depRows.Scan(&id, &email, &total); err != nil {
			continue
		}
		topDepositors = append(topDepositors, map[string]any{"id": id, "email": email, "total_minor": total})
	}
	depRows.Close()

	regTrend := make([]map[string]any, 0)
	trendRows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date AS d, COUNT(*)
		FROM users WHERE created_at > now()-interval '7 days'
		GROUP BY d ORDER BY d`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "trend query failed")
		return
	}
	for trendRows.Next() {
		var d time.Time
		var count int64
		if err := trendRows.Scan(&d, &count); err != nil {
			continue
		}
		regTrend = append(regTrend, map[string]any{"date": d.Format("2006-01-02"), "count": count})
	}
	trendRows.Close()

	writeJSON(w, map[string]any{
		"total_registered":        totalReg,
		"total_with_deposit":      totalWithDep,
		"total_active_7d":         active7d,
		"total_active_30d":        active30d,
		"deposit_conversion_rate": depositConvRate,
		"avg_ltv_minor":           avgLTV,
		"top_depositors":          topDepositors,
		"registrations_trend":     regTrend,
	})
}

func (h *Handler) GameRTPStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	gameID := chi.URLParam(r, "id")
	if gameID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "missing game id")
		return
	}

	var totalBets, totalWins, uniquePlayers int64
	err := h.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END), 0),
			COUNT(DISTINCT user_id)
		FROM ledger_entries
		WHERE entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback') AND metadata->>'game_id' = $1
	`, gameID).Scan(&totalBets, &totalWins, &uniquePlayers)
	if err != nil {
		writeJSON(w, map[string]any{
			"total_bets_minor": 0, "total_wins_minor": 0, "ggr_minor": 0,
			"rtp_pct": 0, "unique_players": 0, "total_sessions": 0,
			"rtp_by_day": []map[string]any{},
		})
		return
	}

	ggr := totalBets - totalWins
	var rtpPct float64
	if totalBets > 0 {
		rtpPct = float64(totalWins) / float64(totalBets) * 100
	}

	var totalSessions int64
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM game_launches WHERE game_id = $1`, gameID).Scan(&totalSessions)

	rtpByDay := make([]map[string]any, 0)
	rows, err := h.Pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date,
			COALESCE(SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END), 0)
		FROM ledger_entries
		WHERE entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback') AND metadata->>'game_id' = $1
			AND created_at > now()-interval '30 days'
		GROUP BY 1 ORDER BY 1`, gameID)
	if err == nil {
		for rows.Next() {
			var d time.Time
			var dayBets, dayWins int64
			if err := rows.Scan(&d, &dayBets, &dayWins); err != nil {
				continue
			}
			var dayRTP float64
			if dayBets > 0 {
				dayRTP = float64(dayWins) / float64(dayBets) * 100
			}
			rtpByDay = append(rtpByDay, map[string]any{
				"date": d.Format("2006-01-02"), "bets_minor": dayBets, "wins_minor": dayWins, "rtp_pct": dayRTP,
			})
		}
		rows.Close()
	}

	writeJSON(w, map[string]any{
		"total_bets_minor": totalBets,
		"total_wins_minor": totalWins,
		"ggr_minor":        ggr,
		"rtp_pct":          rtpPct,
		"unique_players":   uniquePlayers,
		"total_sessions":   totalSessions,
		"rtp_by_day":       rtpByDay,
	})
}

// DashboardSystem exposes pipeline health for the main admin dashboard (mirrors /ops/summary + flags URL).
func (h *Handler) DashboardSystem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var whPending, missingWallet, wdOpen, wfJobs int64
	var bonusOutboxPending, bonusOutboxDLQ int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)::bigint FROM processed_callbacks WHERE processed_at IS NULL),
			(SELECT 0::bigint),
			(SELECT COUNT(*)::bigint FROM payment_withdrawals WHERE provider='passimpay' AND status IN ('LEDGER_LOCKED','SUBMITTED_TO_PROVIDER')),
			(SELECT COUNT(*)::bigint FROM worker_failed_jobs WHERE resolved_at IS NULL),
			(SELECT COUNT(*)::bigint FROM bonus_outbox WHERE processed_at IS NULL AND dlq_at IS NULL),
			(SELECT COUNT(*)::bigint FROM bonus_outbox WHERE processed_at IS NULL AND dlq_at IS NOT NULL)
	`).Scan(&whPending, &missingWallet, &wdOpen, &wfJobs, &bonusOutboxPending, &bonusOutboxDLQ)

	out := map[string]any{
		"webhook_deliveries_pending":    whPending,
		"users_missing_payment_wallet":  missingWallet,
		"withdrawals_in_flight":         wdOpen,
		"worker_failed_jobs_unresolved": wfJobs,
		"bonus_outbox_pending_delivery": bonusOutboxPending,
		"bonus_outbox_dead_letter":      bonusOutboxDLQ,
		"process_metrics":               obs.Snapshot(),
	}
	if h.Redis != nil {
		if n, err := h.Redis.LLen(ctx, "casino:jobs").Result(); err == nil {
			out["redis_queue_depth"] = n
		}
	}
	writeJSON(w, out)
}
