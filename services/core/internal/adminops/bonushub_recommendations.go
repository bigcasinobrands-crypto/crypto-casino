package adminops

import (
	"net/http"
	"time"
)

// bonusHubRecommendations returns lightweight engagement signals and suggested
// promotion templates (wizard deep-links). Heuristics only — tune with analytics later.
func (h *Handler) bonusHubRecommendations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var signups7d, signups30d int64
	var depCount7d, depVol7d int64
	var activeBonuses int64

	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM users WHERE created_at > now() - interval '7 days'
	`).Scan(&signups7d)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM users WHERE created_at > now() - interval '30 days'
	`).Scan(&signups30d)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint,
		       COALESCE(SUM(amount_minor), 0)::bigint
		FROM ledger_entries
		WHERE entry_type = 'deposit.credit' AND created_at > now() - interval '7 days'
	`).Scan(&depCount7d, &depVol7d)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances
		WHERE status = 'active' AND wr_required_minor > wr_contributed_minor
	`).Scan(&activeBonuses)

	signals := map[string]any{
		"signups_7d":          signups7d,
		"signups_30d":         signups30d,
		"deposit_count_7d":    depCount7d,
		"deposit_volume_7d":   depVol7d,
		"active_wr_bonuses":   activeBonuses,
		"generated_at":        time.Now().UTC().Format(time.RFC3339),
		"payments_integrated": true,
		"blueocean_note":      "Game wallet (Blue Ocean) is separate from Fystack deposit bonuses; deposit-match runs on deposit.credit / bonus_payment_settled.",
	}

	recs := []map[string]any{}

	if signups7d >= 3 || signups30d >= 10 {
		recs = append(recs, map[string]any{
			"id":             "welcome_first_deposit",
			"title":          "Welcome first-deposit match",
			"reason":         "Recent sign-up volume supports a clear welcome path.",
			"wizard_preset":  "welcome_deposit",
			"bonus_type":     "deposit_match",
			"suggested_copy": "100% match up to a capped welcome bonus for first deposit only.",
		})
	}

	if depCount7d >= 5 && depVol7d > 0 {
		recs = append(recs, map[string]any{
			"id":             "reload_weekend",
			"title":          "Reload bonus (repeat depositors)",
			"reason":         "Deposit activity in the last 7 days indicates room for a reload offer.",
			"wizard_preset":  "reload",
			"bonus_type":     "reload_deposit",
			"suggested_copy": "Lower cap than welcome; not first-deposit-only.",
		})
	}

	if activeBonuses < 2 && depCount7d > 0 {
		recs = append(recs, map[string]any{
			"id":             "vip_floor_reload",
			"title":          "VIP-only reload",
			"reason":         "Few active wagering bonuses — a tiered offer can lift engagement without crowding WR.",
			"wizard_preset":  "vip_reload",
			"bonus_type":     "reload_deposit",
			"suggested_copy": "Set minimum VIP tier in targeting; cap match for risk control.",
		})
	}

	if len(recs) == 0 {
		recs = append(recs, map[string]any{
			"id":             "starter_welcome",
			"title":          "Starter welcome bonus",
			"reason":         "Default template while metrics are still warming up.",
			"wizard_preset":  "welcome_deposit",
			"bonus_type":     "deposit_match",
			"suggested_copy": "Classic first-deposit match — publish from Schedule & deliver after save.",
		})
	}

	writeJSON(w, map[string]any{"signals": signals, "recommendations": recs})
}
