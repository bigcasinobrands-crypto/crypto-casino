package wallet

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type depositReq struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
}

// DepositSessionHandler creates a Fystack hosted checkout when configured; otherwise inserts a pending local row (stub URL).
func DepositSessionHandler(pool *pgxpool.Pool, cfg *config.Config, fs *fystack.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
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
		if body.AmountMinor < 1 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_amount", "amount_minor must be positive")
			return
		}
		ccy := strings.TrimSpace(body.Currency)
		if ccy == "" {
			ccy = "USD"
		}
		if !strings.EqualFold(ccy, "USD") {
			playerapi.WriteError(w, http.StatusBadRequest, "unsupported_currency", "hosted checkout currently expects USD-priced sessions")
			return
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

		var destWallet string
		_ = pool.QueryRow(r.Context(), `SELECT provider_wallet_id FROM fystack_wallets WHERE user_id = $1::uuid`, uid).Scan(&destWallet)

		price := fmt.Sprintf("%.2f", float64(body.AmountMinor)/100.0)
		checkoutURL := strings.TrimSpace("https://docs.fystack.io/checkout")
		providerID := ""

		if cfg != nil && cfg.FystackConfigured() && fs != nil && destWallet != "" {
			payload := map[string]any{
				"price":                  price,
				"currency":               "USD",
				"supported_assets":       cfg.FystackCheckoutAssetList(),
				"success_url":            cfg.FystackCheckoutSuccessURL,
				"cancel_url":             cfg.FystackCheckoutCancelURL,
				"customer_id":            uid,
				"order_id":               cid,
				"destination_wallet_id":  destWallet,
				"expiry_duration_seconds": 3600,
				"description":            "Account top-up",
			}
			b, _ := json.Marshal(payload)
			resp, st, cerr := fs.CreateCheckout(r.Context(), b)
			if cerr == nil && st >= 200 && st < 300 {
				if s, ok := resp["checkout_url"].(string); ok && s != "" {
					checkoutURL = s
				}
				if s, ok := resp["id"].(string); ok && s != "" {
					providerID = s
				}
				if d, ok := resp["data"].(map[string]any); ok {
					if s, ok := d["checkout_url"].(string); ok && s != "" {
						checkoutURL = s
					}
					if s, ok := d["id"].(string); ok && s != "" {
						providerID = s
					}
				}
				if checkoutURL != "" && !cfg.IsTrustedFystackHTTPSURL(checkoutURL) {
					log.Printf("fystack checkout_url rejected (untrusted): %s", checkoutURL)
					checkoutURL = strings.TrimSpace("https://docs.fystack.io/checkout")
				}
			}
		}

		tag, err := pool.Exec(r.Context(), `
			INSERT INTO fystack_checkouts (id, user_id, status, amount_minor, currency, idempotency_key, raw, provider_checkout_id, checkout_url)
			VALUES ($1, $2::uuid, 'pending', $3, $4, $5, '{}'::jsonb, NULLIF($6,''), NULLIF($7,''))
			ON CONFLICT (idempotency_key) DO NOTHING
		`, cid, uid, body.AmountMinor, ccy, idem, nullStr(providerID), nullStr(checkoutURL))
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "checkout create failed")
			return
		}
		if tag.RowsAffected() == 0 {
			var exID, exSt, exCcy, exProv, exURL string
			var exAmt int64
			_ = pool.QueryRow(r.Context(), `
				SELECT id, status, amount_minor, currency, COALESCE(provider_checkout_id,''), COALESCE(checkout_url,'')
				FROM fystack_checkouts WHERE idempotency_key = $1
			`, idem).Scan(&exID, &exSt, &exAmt, &exCcy, &exProv, &exURL)
			if exURL == "" {
				exURL = checkoutURL
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"checkout_id":          exID,
				"provider_checkout_id": exProv,
				"status":               exSt,
				"amount_minor":         exAmt,
				"currency":             exCcy,
				"checkout_url":         exURL,
				"idempotency_key":      idem,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"checkout_id":       cid,
			"provider_checkout_id": providerID,
			"status":            "pending",
			"amount_minor":      body.AmountMinor,
			"currency":          ccy,
			"checkout_url":      checkoutURL,
			"idempotency_key":   idem,
		})
	}
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
