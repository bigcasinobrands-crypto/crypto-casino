package wallet

import (
	"context"
	"encoding/json"
	"fmt"
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

// passimpayDepositAddress serves GET /v1/wallet/deposit-address when PAYMENT_PROVIDER=passimpay.
func passimpayDepositAddress(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, cfg *config.Config) {
	uid, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if cfg == nil || !cfg.PassimPayConfigured() {
		playerapi.WriteError(w, http.StatusServiceUnavailable, "passimpay_unconfigured", "PassimPay is not configured (PASSIMPAY_PLATFORM_ID + PASSIMPAY_SECRET_KEY)")
		return
	}
	q := r.URL.Query()
	payIDStr := strings.TrimSpace(q.Get("payment_id"))
	if payIDStr == "" {
		playerapi.WriteError(w, http.StatusBadRequest, "missing_payment_id", "pass payment_id (PassimPay currency id from payment_currencies.provider_payment_id)")
		return
	}
	paymentID, err := strconv.Atoi(payIDStr)
	if err != nil || paymentID < 1 {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_payment_id", "payment_id must be a positive integer")
		return
	}
	symbol := strings.TrimSpace(q.Get("symbol"))
	if symbol == "" {
		symbol = "USDT"
	}
	network := config.NormalizeDepositNetwork(q.Get("network"))
	if network == "" {
		network = "ERC20"
	}

	// P8: optional intended amount lets the webhook compare paid vs requested
	// and report CREDITED_FULL vs CREDITED_PARTIALLY accurately.
	var requestedAmountMinor *int64
	if v := strings.TrimSpace(q.Get("amount_minor")); v != "" {
		n, perr := strconv.ParseInt(v, 10, 64)
		if perr != nil || n <= 0 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_amount", "amount_minor must be a positive integer")
			return
		}
		requestedAmountMinor = &n
	}

	// P9: validate (provider_payment_id, symbol, network) against payment_currencies
	// so unknown or disabled currencies cannot reach the provider.
	curr, cerr := loadPassimpayCurrency(r.Context(), pool, paymentID, symbol, network)
	if cerr == pgx.ErrNoRows {
		playerapi.WriteError(w, http.StatusBadRequest, "unsupported_currency", "no payment_currencies row for this provider/payment_id/symbol/network")
		return
	}
	if cerr != nil {
		log.Printf("passimpay deposit-address: payment_currencies lookup err=%v", cerr)
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "currency lookup failed")
		return
	}
	if !curr.DepositEnabled {
		playerapi.WriteError(w, http.StatusForbidden, "deposit_disabled", "deposits are disabled for this currency")
		return
	}

	// P7: enforce server-side minimum deposit (when amount is supplied).
	if requestedAmountMinor != nil && curr.MinDepositMinor != nil && *requestedAmountMinor < *curr.MinDepositMinor {
		playerapi.WriteError(w, http.StatusBadRequest, "below_min_deposit", fmt.Sprintf("minimum deposit is %d minor units", *curr.MinDepositMinor))
		return
	}

	orderID := strings.ReplaceAll(uuid.NewString(), "-", "")
	if len(orderID) > 64 {
		orderID = orderID[:64]
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(cfg.PassimpayRequestTimeoutMs)*time.Millisecond)
	defer cancel()

	client := passimpay.NewClient(cfg.PassimpayAPIBaseURL, cfg.PassimpayPlatformID, cfg.PassimpaySecretKey, time.Duration(cfg.PassimpayRequestTimeoutMs)*time.Millisecond)
	addr, tag, err := client.GetDepositAddress(ctx, paymentID, orderID)
	if err != nil || addr == "" {
		log.Printf("passimpay deposit-address: user=%s payId=%d err=%v", uid, paymentID, err)
		playerapi.WriteError(w, http.StatusBadGateway, "passimpay_error", "could not obtain deposit address")
		return
	}
	if !IsPlausibleOnChainDepositAddress(addr) {
		log.Printf("passimpay deposit-address: reject non-on-chain address from provider user=%s payId=%d addr=%q", uid, paymentID, addr)
		playerapi.WriteError(w, http.StatusBadGateway, "invalid_deposit_address", "provider returned an invalid deposit address")
		return
	}

	// P1: fail-closed if intent insert fails. Returning an address whose intent
	// was never persisted means the corresponding webhook hits the orphan path
	// and the deposit cannot be credited — funds get stuck. Rather than risk
	// that, we fail the request and ask the player to retry.
	var requestedColumn any
	if requestedAmountMinor != nil {
		requestedColumn = *requestedAmountMinor
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO payment_deposit_intents (
			user_id, provider, method, provider_order_id, provider_payment_id, currency, network,
			deposit_address, deposit_tag, requested_amount_minor, status, metadata
		) VALUES ($1::uuid, 'passimpay', $2, $3, $4, $5, $6, $7, NULLIF($8,''), $9, 'ADDRESS_ASSIGNED', $10::jsonb)
	`, uid, strings.TrimSpace(cfg.PassimpayDepositMethod), orderID, fmt.Sprintf("%d", paymentID), strings.ToUpper(symbol), network, addr, tag, requestedColumn, mustJSON(map[string]any{"source": "deposit_address"}))
	if err != nil {
		log.Printf("passimpay deposit intent insert FAILED user=%s order=%s err=%v — refusing to return address (would orphan webhook)", uid, orderID, err)
		playerapi.WriteError(w, http.StatusInternalServerError, "intent_persist_failed", "could not persist deposit intent — please try again")
		return
	}

	out := map[string]any{
		"address":     addr,
		"memo":        tag,
		"memo_tag":    tag,
		"tag_warning": tag != "",
		"symbol":      strings.ToUpper(symbol),
		"network":     network,
		"provider":    "passimpay",
		"order_id":    orderID,
		"payment_id":  paymentID,
	}
	if requestedAmountMinor != nil {
		out["requested_amount_minor"] = *requestedAmountMinor
	}

	if tag != "" {
		out["qr_url"] = "" // Client may encode address+memo in SPA
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
