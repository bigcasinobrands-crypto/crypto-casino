package wallet

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/payments/passimpay"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Matches frontend cashier minimum ($10.00) for deposit pick + invoice.
const minPlayerDepositInvoiceUsdCents int64 = 1000

type depositInvoiceBody struct {
	PaymentID   int    `json:"payment_id"`
	Symbol      string `json:"symbol"`
	Network     string `json:"network"`
	AmountMinor int64  `json:"amount_minor"`
}

// DepositInvoiceHandler POST /v1/wallet/deposit-invoice — PassimPay hosted checkout (Web3 wallet option on their page).
func DepositInvoiceHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
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

		var body depositInvoiceBody
		raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<14))
		if err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_body", "could not read request body")
			return
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "expected JSON body with payment_id, symbol, network, amount_minor")
			return
		}
		if body.PaymentID < 1 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_payment_id", "payment_id must be a positive integer")
			return
		}
		symbol := strings.TrimSpace(body.Symbol)
		if symbol == "" {
			symbol = "USDT"
		}
		network := config.NormalizeDepositNetwork(body.Network)
		if network == "" {
			network = "ERC20"
		}
		if body.AmountMinor < minPlayerDepositInvoiceUsdCents {
			playerapi.WriteError(w, http.StatusBadRequest, "below_min_deposit",
				fmt.Sprintf("minimum deposit is $%.2f USD", float64(minPlayerDepositInvoiceUsdCents)/100))
			return
		}

		curr, cerr := loadPassimpayCurrency(r.Context(), pool, body.PaymentID, symbol, network)
		if cerr == pgx.ErrNoRows {
			playerapi.WriteError(w, http.StatusBadRequest, "unsupported_currency", "no payment_currencies row for this provider/payment_id/symbol/network")
			return
		}
		if cerr != nil {
			log.Printf("passimpay deposit-invoice: payment_currencies lookup err=%v", cerr)
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "currency lookup failed")
			return
		}
		if !curr.DepositEnabled {
			playerapi.WriteError(w, http.StatusForbidden, "deposit_disabled", "deposits are disabled for this currency")
			return
		}
		if curr.MinDepositMinor != nil && body.AmountMinor < *curr.MinDepositMinor {
			playerapi.WriteError(w, http.StatusBadRequest, "below_min_deposit", fmt.Sprintf("minimum deposit is %d minor units", *curr.MinDepositMinor))
			return
		}

		orderID := strings.ReplaceAll(uuid.NewString(), "-", "")
		if len(orderID) > 64 {
			orderID = orderID[:64]
		}
		amountUSD := fmt.Sprintf("%.2f", float64(body.AmountMinor)/100.0)

		ctx, cancel := contextWithPassimpayTimeout(r, cfg)
		defer cancel()

		client := passimpay.NewClient(cfg.PassimpayAPIBaseURL, cfg.PassimpayPlatformID, cfg.PassimpaySecretKey, time.Duration(cfg.PassimpayRequestTimeoutMs)*time.Millisecond)
		payURL, err := client.CreateInvoiceOrder(ctx, orderID, amountUSD, body.PaymentID)
		if err != nil || payURL == "" {
			log.Printf("passimpay deposit-invoice: user=%s payId=%d err=%v", uid, body.PaymentID, err)
			playerapi.WriteError(w, http.StatusBadGateway, "passimpay_error", "could not create payment link")
			return
		}

		expiresAt := time.Now().UTC().Add(time.Duration(cfg.PassimpayDefaultInvoiceExpiry) * time.Minute)
		_, err = pool.Exec(ctx, `
			INSERT INTO payment_deposit_intents (
				user_id, provider, method, provider_order_id, provider_payment_id, currency, network,
				deposit_address, deposit_tag, requested_amount_minor, status, invoice_url, invoice_expires_at, metadata
			) VALUES ($1::uuid, 'passimpay', 'invoice', $2, $3, $4, $5, '', '', $6, 'INVOICE_ISSUED', $7, $8::timestamptz, $9::jsonb)
		`, uid, orderID, strconv.Itoa(body.PaymentID), strings.ToUpper(symbol), network, body.AmountMinor, payURL, expiresAt, mustJSON(map[string]any{"source": "deposit_invoice"}))
		if err != nil {
			log.Printf("passimpay deposit-invoice intent insert FAILED user=%s order=%s err=%v", uid, orderID, err)
			playerapi.WriteError(w, http.StatusInternalServerError, "intent_persist_failed", "could not persist deposit intent — please try again")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"invoice_url": payURL,
			"order_id":    orderID,
			"provider":    "passimpay",
		})
	}
}

func contextWithPassimpayTimeout(r *http.Request, cfg *config.Config) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), time.Duration(cfg.PassimpayRequestTimeoutMs)*time.Millisecond)
}
