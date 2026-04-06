package wallet

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BalancesHandler returns per-currency balances from the ledger for the authenticated player.
func BalancesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		rows, err := pool.Query(r.Context(), `
			SELECT currency, COALESCE(SUM(amount_minor), 0)::bigint AS balance_minor
			FROM ledger_entries
			WHERE user_id = $1::uuid
			GROUP BY currency
			ORDER BY COALESCE(SUM(amount_minor), 0) DESC
		`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()

		seen := map[string]bool{}
		var wallets []map[string]any
		for rows.Next() {
			var ccy string
			var bal int64
			if err := rows.Scan(&ccy, &bal); err != nil {
				continue
			}
			seen[ccy] = true
			wallets = append(wallets, map[string]any{
				"currency":      ccy,
				"balance_minor": bal,
			})
		}
		if !seen["USDT"] {
			wallets = append(wallets, map[string]any{
				"currency":      "USDT",
				"balance_minor": int64(0),
			})
		}
		if wallets == nil {
			wallets = []map[string]any{}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"wallets": wallets})
	}
}
