package wallet

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type depositReq struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
}

// DepositSessionHandler is retained for API compatibility; hosted checkout was removed in favor of PassimPay H2H.
func DepositSessionHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		flags, err := paymentflags.Load(r.Context(), pool)
		if err == nil && !flags.DepositsEnabled {
			playerapi.WriteError(w, http.StatusForbidden, "deposits_disabled", "deposits are temporarily unavailable")
			return
		}
		var body depositReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
			return
		}
		ccy := strings.TrimSpace(body.Currency)
		if ccy == "" {
			ccy = "USD"
		}
		playerapi.WriteError(w, http.StatusGone, "use_passimpay_h2h",
			"Hosted checkout is removed — use GET /v1/wallet/deposit-address?payment_id=… with PassimPay (see payment_currencies). Currency hint was "+ccy+".")
	}
}
