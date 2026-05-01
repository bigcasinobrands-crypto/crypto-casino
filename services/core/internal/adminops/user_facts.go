package adminops

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
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

	var deposits7d, deposits30d, withdrawals7d, withdrawals30d int64
	var depCount7d, depCount30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN entry_type = 'deposit.credit' AND created_at > now() - interval '7 days' THEN amount_minor ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN entry_type = 'deposit.credit' AND created_at > now() - interval '30 days' THEN amount_minor ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN entry_type LIKE 'withdraw%' AND amount_minor < 0 AND created_at > now() - interval '7 days' THEN -amount_minor ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN entry_type LIKE 'withdraw%' AND amount_minor < 0 AND created_at > now() - interval '30 days' THEN -amount_minor ELSE 0 END), 0)::bigint,
			COUNT(*) FILTER (WHERE entry_type = 'deposit.credit' AND created_at > now() - interval '7 days'),
			COUNT(*) FILTER (WHERE entry_type = 'deposit.credit' AND created_at > now() - interval '30 days')
		FROM ledger_entries WHERE user_id = $1::uuid
	`, uid).Scan(&deposits7d, &deposits30d, &withdrawals7d, &withdrawals30d, &depCount7d, &depCount30d)

	var ggr7d, ggr30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(
		  SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END)
		  - SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END), 0)::bigint
		FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')
		  AND created_at > now() - interval '7 days'
	`, uid).Scan(&ggr7d)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(
		  SUM(CASE WHEN entry_type IN ('game.debit','game.bet') THEN ABS(amount_minor) WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor) ELSE 0 END)
		  - SUM(CASE WHEN entry_type IN ('game.credit','game.win') THEN amount_minor ELSE 0 END), 0)::bigint
		FROM ledger_entries
		WHERE user_id = $1::uuid AND entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback')
		  AND created_at > now() - interval '30 days'
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

	writeJSON(w, out)
}
