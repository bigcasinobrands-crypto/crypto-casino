package wallet

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BalancesHandler returns per-currency balances from the ledger for the authenticated player.
// settlement_currency hints the PassimPay internal wallet currency so clients can surface one playable balance.
func BalancesHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		settlement := "EUR"
		if cfg != nil {
			settlement = cfg.PassimPaySettlementCurrency()
		}
		rows, err := pool.Query(r.Context(), `
			SELECT currency, pocket, COALESCE(SUM(amount_minor), 0)::bigint AS balance_minor
			FROM ledger_entries
			WHERE user_id = $1::uuid AND pocket IN ('cash', 'bonus_locked', 'pending_withdrawal')
			GROUP BY currency, pocket
			ORDER BY currency, pocket
		`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()

		type agg struct {
			cash, bonus, pendingWD int64
		}
		byCcy := map[string]*agg{}
		for rows.Next() {
			var ccy, pocket string
			var bal int64
			if err := rows.Scan(&ccy, &pocket, &bal); err != nil {
				continue
			}
			a := byCcy[ccy]
			if a == nil {
				a = &agg{}
				byCcy[ccy] = a
			}
			switch pocket {
			case "bonus_locked":
				a.bonus += bal
			case "pending_withdrawal":
				a.pendingWD += bal
			default:
				a.cash += bal
			}
		}
		var wallets []map[string]any
		for ccy, a := range byCcy {
			entry := map[string]any{
				"currency":                  ccy,
				"cash_minor":                a.cash,
				"bonus_locked_minor":        a.bonus,
				"pending_withdrawal_minor":  a.pendingWD,
				"balance_minor":             a.cash + a.bonus,
				"playable_balance_minor":    a.cash + a.bonus,
				"is_settlement_currency":   strings.EqualFold(ccy, settlement),
			}
			if strings.EqualFold(ccy, settlement) {
				entry["wallet_role"] = "internal_playable"
			} else if a.cash != 0 || a.bonus != 0 || a.pendingWD != 0 {
				entry["wallet_role"] = "legacy_or_provider"
			}
			wallets = append(wallets, entry)
		}
		if _, ok := byCcy[strings.ToUpper(settlement)]; !ok {
			wallets = append(wallets, map[string]any{
				"currency":                   strings.ToUpper(settlement),
				"cash_minor":                 int64(0),
				"bonus_locked_minor":         int64(0),
				"pending_withdrawal_minor":   int64(0),
				"balance_minor":              int64(0),
				"playable_balance_minor":     int64(0),
				"is_settlement_currency":     true,
				"wallet_role":                "internal_playable",
			})
		}
		if wallets == nil {
			wallets = []map[string]any{}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"settlement_currency": settlement,
			"wallets":               wallets,
		})
	}
}
