package wallet

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type depositReq struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
}

// DepositSessionHandler creates a Fystack checkout row (stub until @fystack/sdk / REST wired).
func DepositSessionHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		okVerify, err := playerEmailVerified(r.Context(), pool, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not verify account")
			return
		}
		if !okVerify {
			playerapi.WriteError(w, http.StatusForbidden, "email_not_verified", "verify your email before depositing")
			return
		}
		var body depositReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
			return
		}
		if body.AmountMinor < 1 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_amount", "amount_minor must be positive")
			return
		}
		ccy := strings.TrimSpace(body.Currency)
		if ccy == "" {
			ccy = "USDT"
		}
		idem := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if idem == "" {
			var b [16]byte
			_, _ = rand.Read(b[:])
			idem = hex.EncodeToString(b[:])
		}
		var cb [8]byte
		_, _ = rand.Read(cb[:])
		cid := "chk_" + hex.EncodeToString(cb[:])
		_, err = pool.Exec(r.Context(), `
			INSERT INTO fystack_checkouts (id, user_id, status, amount_minor, currency, idempotency_key, raw)
			VALUES ($1, $2::uuid, 'pending', $3, $4, $5, '{}'::jsonb)
			ON CONFLICT (idempotency_key) DO NOTHING
		`, cid, uid, body.AmountMinor, ccy, idem)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "checkout create failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"checkout_id":     cid,
			"status":          "pending",
			"amount_minor":    body.AmountMinor,
			"currency":        ccy,
			"redirect_stub":   "https://docs.fystack.io/checkout",
			"idempotency_key": idem,
		})
	}
}
