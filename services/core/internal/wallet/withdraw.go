package wallet

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/market"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type withdrawReq struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	Network     string `json:"network"`
	Destination string `json:"destination"`
	// FingerprintRequestID from the browser agent (GET /events enrichment on the API).
	FingerprintRequestID string `json:"fingerprint_request_id"`
}

// WithdrawHandler debits the ledger and submits crypto payout via PassimPay when configured.
func WithdrawHandler(pool *pgxpool.Pool, cfg *config.Config, tickers *market.CryptoTickers, fp *fingerprint.Client, sender mail.Sender) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		flags, err := paymentflags.Load(r.Context(), pool)
		if err == nil && !flags.WithdrawalsEnabled {
			playerapi.WriteError(w, http.StatusForbidden, "withdrawals_disabled", "withdrawals are temporarily unavailable")
			return
		}
		if cfg != nil && cfg.UsesPassimpay() {
			withdrawalPassimpay(w, r, pool, cfg, tickers, fp, sender)
			return
		}
		playerapi.WriteError(w, http.StatusServiceUnavailable, "passimpay_required",
			"Withdrawals use PassimPay only — set PAYMENT_PROVIDER=passimpay and configure PASSIMPAY_* credentials.")
	}
}

// mergeWithdrawFingerprintMeta enriches ledger metadata from Fingerprint Server API.
// Returns the raw Get Event JSON when the Server API call succeeds (for risk_assessments audit rows).
func mergeWithdrawFingerprintMeta(ctx context.Context, meta map[string]any, cfg *config.Config, fp *fingerprint.Client, fpReq string) map[string]any {
	if fpReq != "" {
		meta["fingerprint_request_id"] = fpReq
	}
	if fpReq == "" {
		meta["fingerprint_missing"] = true
		return nil
	}
	if cfg == nil || !cfg.FingerprintConfigured() || fp == nil || !fp.Configured() {
		meta["fingerprint_server_unconfigured"] = true
		return nil
	}
	raw, err := fp.GetEvent(ctx, fpReq)
	if err != nil {
		log.Printf("fingerprint: withdraw GetEvent failed request_id=%s: %v", fpReq, err)
		meta["fingerprint_fetch_error"] = true
		meta["fingerprint_fetch_error_detail"] = err.Error()
		return nil
	}
	for k, v := range fingerprint.LedgerMetaFromEvent(raw) {
		meta[k] = v
	}
	meta["risk_decision"] = "PROCEED"
	return raw
}

func extractProviderMessage(resp map[string]any) string {
	if resp == nil {
		return ""
	}
	if s, ok := resp["message"].(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	if d, ok := resp["data"].(map[string]any); ok {
		if s, ok := d["message"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
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

// centsToTokenAmount converts USD cents to token amount strings for provider APIs.
// Stablecoins (USDT, USDC) are 1:1 with USD; volatile assets use the live CMC price.
func centsToTokenAmount(symbol string, cents int64, tickers *market.CryptoTickers) (string, error) {
	usd := float64(cents) / 100.0
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	switch sym {
	case "USDT", "USDC":
		return fmt.Sprintf("%.2f", usd), nil
	default:
		price := tickers.PriceUSD(sym)
		if price <= 0 {
			return "", fmt.Errorf("no price available for %s", sym)
		}
		tokenAmt := usd / price
		return fmt.Sprintf("%.8f", tokenAmt), nil
	}
}
