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

	_, err = pool.Exec(ctx, `
		INSERT INTO payment_deposit_intents (
			user_id, provider, method, provider_order_id, provider_payment_id, currency, network,
			deposit_address, deposit_tag, status, metadata
		) VALUES ($1::uuid, 'passimpay', $2, $3, $4, $5, $6, $7, NULLIF($8,''), 'ADDRESS_ASSIGNED', $9::jsonb)
	`, uid, strings.TrimSpace(cfg.PassimpayDepositMethod), orderID, fmt.Sprintf("%d", paymentID), strings.ToUpper(symbol), network, addr, tag, mustJSON(map[string]any{"source": "deposit_address"}))
	if err != nil {
		log.Printf("passimpay deposit intent insert: %v", err)
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

	if tag != "" {
		out["qr_url"] = "" // Client may encode address+memo in SPA
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
