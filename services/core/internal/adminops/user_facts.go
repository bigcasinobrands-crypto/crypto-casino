package adminops

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// GetUserFacts aggregates rolling windows and risk summaries for admin player view.
func (h *Handler) GetUserFacts(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "id")
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	ctx := r.Context()

	// Deposits use 'deposit.credit' only. Withdrawals for player economics use PassimPay
	// COMPLETED payouts (terminal provider success), not ledger submit-time lines.
	var deposits7d, deposits30d, withdrawals7d, withdrawals30d int64
	var depCount7d, depCount30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN entry_type = 'deposit.credit' AND created_at > now() - interval '7 days' THEN amount_minor ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN entry_type = 'deposit.credit' AND created_at > now() - interval '30 days' THEN amount_minor ELSE 0 END), 0)::bigint,
			(SELECT COALESCE(SUM(COALESCE(internal_amount_minor, amount_minor)), 0)::bigint FROM payment_withdrawals
			 WHERE user_id = $1::uuid AND provider = 'passimpay' AND status IN ('COMPLETED','PAID') AND updated_at > now() - interval '7 days'),
			(SELECT COALESCE(SUM(COALESCE(internal_amount_minor, amount_minor)), 0)::bigint FROM payment_withdrawals
			 WHERE user_id = $1::uuid AND provider = 'passimpay' AND status IN ('COMPLETED','PAID') AND updated_at > now() - interval '30 days'),
			COUNT(*) FILTER (WHERE entry_type = 'deposit.credit' AND created_at > now() - interval '7 days'),
			COUNT(*) FILTER (WHERE entry_type = 'deposit.credit' AND created_at > now() - interval '30 days')
		FROM ledger_entries WHERE user_id = $1::uuid
	`, uid).Scan(&deposits7d, &deposits30d, &withdrawals7d, &withdrawals30d, &depCount7d, &depCount30d)

	// Per-user GGR includes both casino and sportsbook stake/win activity.
	ngrF := ledger.NGRReportingFilterSQL("le")
	var ggr7d, ggr30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(
		  SUM(CASE WHEN le.entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(le.amount_minor) WHEN le.entry_type IN ('game.rollback','sportsbook.rollback') THEN -ABS(le.amount_minor) ELSE 0 END)
		  - SUM(CASE WHEN le.entry_type IN ('game.credit','game.win','game.win_rollback','sportsbook.credit') THEN le.amount_minor ELSE 0 END), 0)::bigint
		FROM ledger_entries le
		WHERE le.user_id = $1::uuid AND le.entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback','game.win_rollback','sportsbook.debit','sportsbook.credit','sportsbook.rollback')
		  AND le.created_at > now() - interval '7 days' AND `+ngrF+`
	`, uid).Scan(&ggr7d)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(
		  SUM(CASE WHEN le.entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(le.amount_minor) WHEN le.entry_type IN ('game.rollback','sportsbook.rollback') THEN -ABS(le.amount_minor) ELSE 0 END)
		  - SUM(CASE WHEN le.entry_type IN ('game.credit','game.win','game.win_rollback','sportsbook.credit') THEN le.amount_minor ELSE 0 END), 0)::bigint
		FROM ledger_entries le
		WHERE le.user_id = $1::uuid AND le.entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback','game.win_rollback','sportsbook.debit','sportsbook.credit','sportsbook.rollback')
		  AND le.created_at > now() - interval '30 days' AND `+ngrF+`
	`, uid).Scan(&ggr30d)

	var launches7d, launches30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE created_at > now() - interval '7 days'),
			COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')
		FROM game_launches WHERE user_id = $1::uuid
	`, uid).Scan(&launches7d, &launches30d)

	var bonusGrants30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances
		WHERE user_id = $1::uuid AND created_at > now() - interval '30 days'
		  AND status IN ('active', 'completed', 'expired', 'forfeited')
	`, uid).Scan(&bonusGrants30d)

	var allowedR, deniedR, manualR int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE decision = 'allowed'),
			COUNT(*) FILTER (WHERE decision = 'denied'),
			COUNT(*) FILTER (WHERE decision = 'manual_review')
		FROM bonus_risk_decisions WHERE user_id = $1::uuid
	`, uid).Scan(&allowedR, &deniedR, &manualR)

	var lastAct *time.Time
	_ = h.Pool.QueryRow(ctx, `
		SELECT MAX(created_at) FROM ledger_entries WHERE user_id = $1::uuid
	`, uid).Scan(&lastAct)

	vip := map[string]any{}
	var tierName *string
	var points, lifeWager int64
	err := h.Pool.QueryRow(ctx, `
		SELECT vt.name, pvs.points_balance, pvs.lifetime_wager_minor
		FROM player_vip_state pvs
		LEFT JOIN vip_tiers vt ON vt.id = pvs.tier_id
		WHERE pvs.user_id = $1::uuid
	`, uid).Scan(&tierName, &points, &lifeWager)
	if err == nil {
		if tierName != nil {
			vip["tier"] = *tierName
		}
		vip["points"] = points
		vip["lifetime_wager_minor"] = lifeWager
	}

	riskSummary := map[string]any{
		"bonus_risk_allowed":       allowedR,
		"bonus_risk_denied":        deniedR,
		"bonus_risk_manual_review": manualR,
	}

	var watch bool
	var watchReason string
	werr := h.Pool.QueryRow(ctx, `
		SELECT active, COALESCE(reason,'') FROM player_watchlist WHERE user_id = $1::uuid
	`, uid).Scan(&watch, &watchReason)
	if werr == pgx.ErrNoRows {
		watch = false
		watchReason = ""
	}
	riskSummary["watchlist"] = watch
	if watchReason != "" {
		riskSummary["watchlist_reason"] = watchReason
	}

	var notes string
	_ = h.Pool.QueryRow(ctx, `SELECT body FROM player_internal_notes WHERE user_id = $1::uuid`, uid).Scan(&notes)

	var latestSignal map[string]any
	var sigType *string
	var sigScore int
	var sigPayload []byte
	var sigAt *time.Time
	err = h.Pool.QueryRow(ctx, `
		SELECT signal_type, score, payload, created_at FROM player_risk_signals
		WHERE user_id = $1::uuid ORDER BY id DESC LIMIT 1
	`, uid).Scan(&sigType, &sigScore, &sigPayload, &sigAt)
	if err == nil {
		latestSignal = map[string]any{"score": sigScore}
		if sigType != nil {
			latestSignal["type"] = *sigType
		}
		if sigAt != nil {
			latestSignal["at"] = sigAt.UTC().Format(time.RFC3339)
		}
		var pl any
		if json.Unmarshal(sigPayload, &pl) == nil {
			latestSignal["payload"] = pl
		}
	}

	out := map[string]any{
		"user_id": uid,
		"windows": map[string]any{
			"deposits_minor_7d":     deposits7d,
			"deposits_minor_30d":    deposits30d,
			"deposits_count_7d":     depCount7d,
			"deposits_count_30d":    depCount30d,
			"withdrawals_minor_7d":  withdrawals7d,
			"withdrawals_minor_30d": withdrawals30d,
			"ggr_proxy_minor_7d":    ggr7d,
			"ggr_proxy_minor_30d":   ggr30d,
			"game_launches_7d":      launches7d,
			"game_launches_30d":     launches30d,
			"bonus_grants_30d":      bonusGrants30d,
		},
		"vip":          vip,
		"risk_summary": riskSummary,
		"internal_notes": notes,
	}
	if lastAct != nil {
		out["last_activity_at"] = lastAct.UTC().Format(time.RFC3339)
	}
	if latestSignal != nil {
		out["latest_risk_signal"] = latestSignal
	}

	var boRemote string
	switch err := h.Pool.QueryRow(ctx, `
		SELECT remote_player_id FROM blueocean_player_links WHERE user_id = $1::uuid
	`, uid).Scan(&boRemote); err {
	case nil:
		out["blue_ocean_player_id"] = boRemote
	case pgx.ErrNoRows:
		out["blue_ocean_player_id"] = nil
	default:
		out["blue_ocean_player_id"] = nil
	}

	sessRows, err := h.Pool.Query(ctx, `
		SELECT id::text, family_id::text, created_at, expires_at, last_seen_at,
			client_ip, user_agent, country_iso2, region, city, device_type,
			fingerprint_visitor_id, geo_source,
			CASE WHEN fingerprint_request_id = '' THEN false ELSE true END
		FROM player_sessions
		WHERE user_id = $1::uuid AND expires_at > now()
		ORDER BY last_seen_at DESC
		LIMIT 50
	`, uid)
	if err == nil {
		defer sessRows.Close()
		var sessions []map[string]any
		for sessRows.Next() {
			var id, fam, cip, ua, cc, reg, city, dev, fvid, gsrc string
			var hasFP bool
			var created, exp, seen time.Time
			if err := sessRows.Scan(&id, &fam, &created, &exp, &seen, &cip, &ua, &cc, &reg, &city, &dev, &fvid, &gsrc, &hasFP); err != nil {
				break
			}
			sessions = append(sessions, map[string]any{
				"id":                    id,
				"family_id":             fam,
				"created_at":            created.UTC().Format(time.RFC3339),
				"expires_at":            exp.UTC().Format(time.RFC3339),
				"last_seen_at":          seen.UTC().Format(time.RFC3339),
				"client_ip":             cip,
				"user_agent":            ua,
				"country_iso2":          cc,
				"region":                reg,
				"city":                  city,
				"device_type":           dev,
				"fingerprint_visitor_id": fvid,
				"geo_source":            gsrc,
				"has_fingerprint_request": hasFP,
			})
		}
		if err := sessRows.Err(); err == nil {
			out["active_sessions"] = sessions
		}
	}

	writeJSON(w, out)
}
