package wallet

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seamlessPlayerWalletSettings(cfg *config.Config) (ccy string, multi bool) {
	if cfg == nil {
		return "EUR", false
	}
	ccy = strings.ToUpper(strings.TrimSpace(cfg.BlueOceanCurrency))
	if ccy == "" {
		ccy = "EUR"
	}
	return ccy, cfg.BlueOceanMulticurrency
}

// BalanceHandler returns playable cash+bonus for the same currency rules as the Blue Ocean seamless wallet
// (BLUEOCEAN_CURRENCY + BLUEOCEAN_MULTICURRENCY), so the header matches in-game balance. Summing every
// ledger currency (legacy BalanceMinor) double-counts incompatible assets (e.g. EUR play + USDT lines).
func BalanceHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		ctx := r.Context()
		ccy, multi := seamlessPlayerWalletSettings(cfg)
		sum, err := ledger.BalancePlayableSeamless(ctx, pool, id, ccy, multi)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "balance failed")
			return
		}
		cash, _ := ledger.BalanceCashSeamless(ctx, pool, id, ccy, multi)
		bonus, _ := ledger.BalanceBonusLockedSeamless(ctx, pool, id, ccy, multi)
		pendingWD, _ := ledger.BalancePendingWithdrawal(ctx, pool, id)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"balance_minor":               sum,
			"cash_minor":                  cash,
			"bonus_locked_minor":          bonus,
			"pending_withdrawal_minor":    pendingWD,
			"playable_balance_minor":      sum,
			"currency":                    ccy,
		})
	}
}
