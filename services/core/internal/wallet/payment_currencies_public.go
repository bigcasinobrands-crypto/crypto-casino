package wallet

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PaymentCurrenciesHandler serves GET /v1/wallet/payment-currencies — PassimPay currency rows for the cashier UI.
// Exposes only non-secret operational fields from payment_currencies.
func PaymentCurrenciesHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		if cfg == nil || !cfg.UsesPassimpay() {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider":"none","currencies":[]}`))
			return
		}

		rows, err := pool.Query(r.Context(), `
			SELECT provider_payment_id::text,
			       UPPER(TRIM(symbol)),
			       COALESCE(UPPER(TRIM(network)), ''),
			       decimals,
			       min_deposit_minor,
			       min_withdraw_minor,
			       deposit_enabled,
			       withdraw_enabled,
			       requires_tag,
			       COALESCE(metadata->>'label','')
			FROM payment_currencies
			WHERE provider = 'passimpay'
			  AND (deposit_enabled = true OR withdraw_enabled = true)
			ORDER BY symbol ASC, network ASC NULLS LAST
		`)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not load payment currencies")
			return
		}
		defer rows.Close()

		list := make([]map[string]any, 0, 64)
		for rows.Next() {
			var payIDStr, sym, net string
			var decimals int
			var minDep, minWd *int64
			var depEn, wdEn, reqTag bool
			var label string
			if err := rows.Scan(&payIDStr, &sym, &net, &decimals, &minDep, &minWd, &depEn, &wdEn, &reqTag, &label); err != nil {
				continue
			}
			pid, err := strconv.Atoi(strings.TrimSpace(payIDStr))
			if err != nil || pid < 1 {
				continue
			}
			item := map[string]any{
				"payment_id":       pid,
				"symbol":           sym,
				"network":          net,
				"decimals":         decimals,
				"deposit_enabled":  depEn,
				"withdraw_enabled": wdEn,
				"requires_tag":     reqTag,
			}
			if strings.TrimSpace(label) != "" {
				item["label"] = strings.TrimSpace(label)
			}
			if minDep != nil {
				item["min_deposit_minor"] = *minDep
			}
			if minWd != nil {
				item["min_withdraw_minor"] = *minWd
			}
			list = append(list, item)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"provider":   "passimpay",
			"currencies": list,
		})
	}
}
