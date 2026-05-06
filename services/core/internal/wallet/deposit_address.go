package wallet

import (
	"net/http"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DepositAddressHandler returns an on-chain deposit address via PassimPay H2H (payment_id flow).
func DepositAddressHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg != nil && cfg.UsesPassimpay() {
			passimpayDepositAddress(w, r, pool, cfg)
			return
		}
		playerapi.WriteError(w, http.StatusServiceUnavailable, "passimpay_required",
			"Deposits use PassimPay only — set PAYMENT_PROVIDER=passimpay and configure PASSIMPAY_* credentials.")
	}
}
