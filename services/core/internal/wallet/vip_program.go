package wallet

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VIPProgramHandler returns published VIP tiers for the marketing / VIP page (no auth).
// Tiers with perks.hide_from_public_page = true are omitted.
func VIPProgramHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := pool.Query(r.Context(), `
			SELECT id, sort_order, name, min_lifetime_wager_minor, perks
			FROM vip_tiers
			ORDER BY sort_order ASC, id ASC
		`)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		ctx := r.Context()
		var tiers []map[string]any
		for rows.Next() {
			var id, sort int
			var name string
			var minW int64
			var perks []byte
			if err := rows.Scan(&id, &sort, &name, &minW, &perks); err != nil {
				continue
			}
			var pm map[string]any
			_ = json.Unmarshal(perks, &pm)
			if pm == nil {
				pm = map[string]any{}
			}
			if hide, ok := pm["hide_from_public_page"].(bool); ok && hide {
				continue
			}
			tb, _ := bonus.VipTierBenefitsForProgram(ctx, pool, id)
			if tb == nil {
				tb = []map[string]any{}
			}
			tiers = append(tiers, map[string]any{
				"id":                         id,
				"sort_order":                 sort,
				"name":                       name,
				"min_lifetime_wager_minor":   minW,
				"perks":                      pm,
				"tier_benefits":              tb,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"tiers": tiers})
	}
}
