package wallet

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type withdrawReq struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	Destination string `json:"destination"`
}

// WithdrawHandler records a withdrawal, debits the ledger, and calls Fystack when treasury is configured.
func WithdrawHandler(pool *pgxpool.Pool, cfg *config.Config, fs *fystack.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		flags, err := paymentflags.Load(r.Context(), pool)
		if err == nil && !flags.WithdrawalsEnabled {
			playerapi.WriteError(w, http.StatusForbidden, "withdrawals_disabled", "withdrawals are temporarily unavailable")
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

		var existingID, existingStatus string
		err = pool.QueryRow(r.Context(), `
			SELECT id, status FROM fystack_withdrawals WHERE idempotency_key = $1
		`, idem).Scan(&existingID, &existingStatus)
		if err == nil && existingID != "" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withdrawal_id": existingID,
				"status":        existingStatus,
				"amount_minor":  body.AmountMinor,
				"currency":      ccy,
			})
			return
		}

		var wb [8]byte
		_, _ = rand.Read(wb[:])
		wid := "wdr_" + hex.EncodeToString(wb[:])

		tx, err := pool.Begin(r.Context())
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "tx begin failed")
			return
		}
		defer tx.Rollback(r.Context())

		if _, err := tx.Exec(r.Context(), `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, uid); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "user lock failed")
			return
		}
		bal, err := ledger.BalanceMinorTx(r.Context(), tx, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "balance failed")
			return
		}
		if bal < body.AmountMinor {
			playerapi.WriteError(w, http.StatusBadRequest, "insufficient_balance", "not enough balance")
			return
		}

		debitKey := "fystack:wdr:" + wid
		_, err = ledger.ApplyDebitTx(r.Context(), tx, uid, ccy, "withdrawal.debit", debitKey, body.AmountMinor, map[string]any{"destination": body.Destination})
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "ledger debit failed")
			return
		}

		rawInit, _ := json.Marshal(map[string]any{"destination": body.Destination})
		_, err = tx.Exec(r.Context(), `
			INSERT INTO fystack_withdrawals (id, user_id, status, amount_minor, currency, destination, idempotency_key, raw, fystack_asset_id)
			VALUES ($1, $2::uuid, 'pending', $3, $4, $5, $6, $7::jsonb, NULLIF($8,''))
		`, wid, uid, body.AmountMinor, ccy, body.Destination, idem, rawInit, nullString(cfg.FystackWithdrawAssetID))
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "withdraw create failed")
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "commit failed")
			return
		}

		providerWid := ""
		status := "pending"
		if cfg != nil && cfg.FystackWithdrawConfigured() && fs != nil {
			dec := 6
			if cfg.FystackWithdrawAssetDecimals > 0 {
				dec = cfg.FystackWithdrawAssetDecimals
			}
			amtStr := minorToDecimalString(body.AmountMinor, dec)
			apiIDem := idem
			resp, st, rerr := fs.RequestWithdrawal(r.Context(), cfg.FystackTreasuryWalletID, cfg.FystackWithdrawAssetID, amtStr, body.Destination, apiIDem)
			if rerr != nil || st < 200 || st >= 300 {
				_, _ = ledger.ApplyCredit(r.Context(), pool, uid, ccy, "withdrawal.compensation", "fystack:wdr_api_fail:"+wid, body.AmountMinor, map[string]any{"withdrawal_id": wid})
				_, _ = pool.Exec(r.Context(), `UPDATE fystack_withdrawals SET status = 'provider_error', raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb WHERE id = $1`, wid, mustJSON(map[string]any{"http_status": st, "err": errString(rerr)}))
				status = "provider_error"
			} else {
				providerWid = withdrawalIDFromFystack(resp)
				_, _ = pool.Exec(r.Context(), `
					UPDATE fystack_withdrawals SET provider_withdrawal_id = NULLIF($2,''), status = 'submitted',
					raw = COALESCE(raw, '{}'::jsonb) || $3::jsonb
					WHERE id = $1
				`, wid, providerWid, mustJSON(resp))
				status = "submitted"
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"withdrawal_id":          wid,
			"provider_withdrawal_id":   providerWid,
			"status":                   status,
			"amount_minor":             body.AmountMinor,
			"currency":                 ccy,
		})
	}
}

func nullString(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func mustJSON(v map[string]any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func errString(e error) string {
	if e == nil {
		return ""
	}
	return e.Error()
}

func withdrawalIDFromFystack(m map[string]any) string {
	if m == nil {
		return ""
	}
	if s, ok := m["id"].(string); ok && s != "" {
		return s
	}
	if d, ok := m["data"].(map[string]any); ok {
		if s, ok := d["id"].(string); ok {
			return s
		}
		if s, ok := d["withdrawal_id"].(string); ok {
			return s
		}
	}
	return ""
}
