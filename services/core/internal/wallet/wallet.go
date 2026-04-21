package wallet

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

func BalanceHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		sum, err := ledger.BalanceMinor(r.Context(), pool, id)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "balance failed")
			return
		}
		cash, _ := ledger.BalanceCash(r.Context(), pool, id)
		bonus, _ := ledger.BalanceBonusLocked(r.Context(), pool, id)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"balance_minor":          sum,
			"cash_minor":             cash,
			"bonus_locked_minor":     bonus,
			"currency":               "USDT",
		})
	}
}
