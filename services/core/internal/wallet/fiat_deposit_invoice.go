package wallet

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/payments/passimpay"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fiatDepositInvoiceBody struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
}

var allowedFiatInvoiceCurrencies = map[string]bool{
	"USD": true,
	"EUR": true,
	"GBP": true,
	"CAD": true,
	"AUD": true,
}

// FiatDepositInvoiceHandler POST /v1/wallet/fiat-deposit-invoice — PassimPay hosted fiat on-ramp (createorder type=2).
func FiatDepositInvoiceHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if cfg == nil || !cfg.UsesPassimpay() || !cfg.PassimPayConfigured() {
			playerapi.WriteError(w, http.StatusServiceUnavailable, "passimpay_unconfigured", "PassimPay is not configured")
			return
		}
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		var body fiatDepositInvoiceBody
		raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<14))
		if err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_body", "could not read request body")
			return
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "expected JSON body with amount_minor")
			return
		}
		cur := strings.ToUpper(strings.TrimSpace(body.Currency))
		if cur == "" {
			cur = "USD"
		}
		if len(cur) != 3 || !allowedFiatInvoiceCurrencies[cur] {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_currency", "unsupported fiat currency")
			return
		}

		if body.AmountMinor < minPlayerDepositInvoiceUsdCents {
			playerapi.WriteError(w, http.StatusBadRequest, "below_min_deposit",
				fmt.Sprintf("minimum deposit is %.2f %s", float64(minPlayerDepositInvoiceUsdCents)/100, cur))
			return
		}

		orderID := strings.ReplaceAll(uuid.NewString(), "-", "")
		if len(orderID) > 64 {
			orderID = orderID[:64]
		}
		amountStr := fmt.Sprintf("%.2f", float64(body.AmountMinor)/100.0)

		ctx, cancel := contextWithPassimpayTimeout(r, cfg)
		defer cancel()

		client := passimpay.NewClient(cfg.PassimpayAPIBaseURL, cfg.PassimpayPlatformID, cfg.PassimpaySecretKey, time.Duration(cfg.PassimpayRequestTimeoutMs)*time.Millisecond)
		payURL, err := client.CreateFiatInvoiceOrder(ctx, orderID, amountStr, cur)
		if err != nil || payURL == "" {
			log.Printf("passimpay fiat-deposit-invoice: user=%s err=%v", uid, err)
			playerapi.WriteError(w, http.StatusBadGateway, "passimpay_error", "could not create fiat payment link")
			return
		}

		expiresAt := time.Now().UTC().Add(time.Duration(cfg.PassimpayDefaultInvoiceExpiry) * time.Minute)
		_, err = pool.Exec(ctx, `
			INSERT INTO payment_deposit_intents (
				user_id, provider, method, provider_order_id, provider_payment_id, currency, network,
				deposit_address, deposit_tag, requested_amount_minor, status, invoice_url, invoice_expires_at, metadata
			) VALUES ($1::uuid, 'passimpay', 'invoice_fiat', $2, NULL, $7, NULL, '', '', $3, 'INVOICE_ISSUED', $4, $5::timestamptz, $6::jsonb)
		`, uid, orderID, body.AmountMinor, payURL, expiresAt, mustJSON(map[string]any{"source": "fiat_deposit_invoice"}), cur)
		if err != nil {
			log.Printf("passimpay fiat-deposit-invoice intent insert FAILED user=%s order=%s err=%v", uid, orderID, err)
			playerapi.WriteError(w, http.StatusInternalServerError, "intent_persist_failed", "could not persist deposit intent — please try again")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"invoice_url": payURL,
			"order_id":    orderID,
			"provider":    "passimpay",
			"invoice_kind": "fiat",
		})
	}
}
