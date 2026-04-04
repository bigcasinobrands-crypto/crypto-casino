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

type withdrawReq struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	Destination string `json:"destination"`
}

// WithdrawHandler records a withdrawal request (Fystack payout API to be wired).
func WithdrawHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
			playerapi.WriteError(w, http.StatusForbidden, "email_not_verified", "verify your email before withdrawing")
			return
		}
		var body withdrawReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
			return
		}
		if body.AmountMinor < 1 || strings.TrimSpace(body.Destination) == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "amount and destination required")
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
		var wb [8]byte
		_, _ = rand.Read(wb[:])
		wid := "wdr_" + hex.EncodeToString(wb[:])
		_, err = pool.Exec(r.Context(), `
			INSERT INTO fystack_withdrawals (id, user_id, status, amount_minor, currency, destination, idempotency_key, raw)
			VALUES ($1, $2::uuid, 'pending', $3, $4, $5, $6, '{}'::jsonb)
			ON CONFLICT (idempotency_key) DO NOTHING
		`, wid, uid, body.AmountMinor, ccy, body.Destination, idem)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "withdraw create failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"withdrawal_id": wid,
			"status":          "pending",
			"amount_minor":    body.AmountMinor,
			"currency":        ccy,
		})
	}
}
