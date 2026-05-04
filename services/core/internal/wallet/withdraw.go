package wallet

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/market"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/reconcile"
	"github.com/crypto-casino/core/internal/riskassessment"
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

// WithdrawHandler debits the ledger and sends from the user's own Fystack wallet.
func WithdrawHandler(pool *pgxpool.Pool, cfg *config.Config, fs *fystack.Client, tickers *market.CryptoTickers, fp *fingerprint.Client) http.HandlerFunc {
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
		if cfg != nil && cfg.WithdrawRequireFingerprint && strings.TrimSpace(body.FingerprintRequestID) == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "fingerprint_required", "identification is required for this withdrawal")
			return
		}
		ccy := strings.ToUpper(strings.TrimSpace(body.Currency))
		if ccy == "" {
			ccy = "USDT"
		}
		network := config.NormalizeDepositNetwork(body.Network)
		if network == "" {
			network = "ERC20"
		}

		// Resolve the Fystack asset ID from symbol+network.
		assetID := resolveWithdrawAssetID(cfg, ccy, network)
		if assetID == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "unsupported_asset", "no Fystack asset configured for "+ccy+" on "+network)
			return
		}

		if blocked, msg, err := bonus.WithdrawPolicyBlock(r.Context(), pool, uid); err == nil && blocked {
			playerapi.WriteError(w, http.StatusForbidden, "bonus_blocks_withdraw", msg)
			return
		}

		// Fraud checks before proceeding
		fc := RunFraudChecks(r.Context(), pool, cfg, uid, body.AmountMinor)
		if !fc.Allowed {
			log.Printf("fraud check blocked withdrawal: user=%s amount=%d reason=%s", uid, body.AmountMinor, fc.Reason)
			playerapi.WriteError(w, http.StatusForbidden, "fraud_check_failed", fc.Reason)
			return
		}

		// Look up the user's own Fystack wallet.
		var userWalletID string
		err = pool.QueryRow(r.Context(), `SELECT provider_wallet_id FROM fystack_wallets WHERE user_id = $1::uuid AND status = 'active'`, uid).Scan(&userWalletID)
		if err != nil || userWalletID == "" {
			playerapi.WriteError(w, http.StatusConflict, "wallet_pending", "wallet not provisioned yet; try again shortly")
			return
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
		cashBal, err := ledger.BalanceCashTx(r.Context(), tx, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "balance failed")
			return
		}
		if cashBal < body.AmountMinor {
			playerapi.WriteError(w, http.StatusBadRequest, "insufficient_balance", "not enough withdrawable cash balance")
			return
		}

		debitKey := "fystack:wdr:" + wid
		meta := map[string]any{
			"destination":   body.Destination,
			"withdrawal_id": wid,
			"action_type":   "withdrawal_request",
		}
		rawFP := mergeWithdrawFingerprintMeta(r.Context(), meta, cfg, fp, strings.TrimSpace(body.FingerprintRequestID))
		if err := fingerprint.MergeTrafficAttributionTx(r.Context(), tx, uid, time.Now().UTC(), meta); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "attribution merge failed")
			return
		}
		_, err = ledger.ApplyDebitTx(r.Context(), tx, uid, ccy, "withdrawal.debit", debitKey, body.AmountMinor, meta)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "ledger debit failed")
			return
		}

		rawInit, _ := json.Marshal(map[string]any{"destination": body.Destination, "network": network})
		_, err = tx.Exec(r.Context(), `
			INSERT INTO fystack_withdrawals (id, user_id, status, amount_minor, currency, destination, idempotency_key, raw, fystack_asset_id)
			VALUES ($1, $2::uuid, 'pending', $3, $4, $5, $6, $7::jsonb, NULLIF($8,''))
		`, wid, uid, body.AmountMinor, ccy, body.Destination, idem, rawInit, assetID)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "withdraw create failed")
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "commit failed")
			return
		}

		if rawFP != nil {
			vid, _ := meta["visitor_id"].(string)
			if err := riskassessment.InsertFromEvent(r.Context(), pool, uid, "withdrawal_request",
				strings.TrimSpace(body.FingerprintRequestID), strings.TrimSpace(vid), rawFP, meta); err != nil {
				log.Printf("risk_assessments insert: %v", err)
			}
		}
		if err := reconcile.MaybeInsertGeoTrafficMismatch(r.Context(), pool, uid, "withdrawal", wid, meta); err != nil {
			log.Printf("reconciliation_alerts insert: %v", err)
		}

		providerWid := ""
		status := "pending"
		if cfg != nil && cfg.FystackConfigured() && fs != nil {
			amtStr, convErr := centsToTokenAmount(ccy, body.AmountMinor, tickers)
			if convErr != nil {
				log.Printf("fystack withdraw: price conversion failed for %s: %v", ccy, convErr)
				playerapi.WriteError(w, http.StatusBadGateway, "price_unavailable", "cannot get current "+ccy+" price for withdrawal; try again shortly")
				return
			}
			log.Printf("fystack withdraw: user=%s wid=%s wallet=%s asset=%s amount=%s dest=%s", uid, wid, userWalletID, assetID, amtStr, body.Destination)
			resp, st, rerr := fs.RequestWithdrawal(r.Context(), userWalletID, assetID, amtStr, body.Destination, idem)
			if rerr != nil || st < 200 || st >= 300 {
				log.Printf("fystack withdraw: FAILED wid=%s status=%d err=%v resp=%v", wid, st, rerr, resp)
				_, _ = ledger.ApplyCredit(r.Context(), pool, uid, ccy, "withdrawal.compensation", "fystack:wdr_api_fail:"+wid, body.AmountMinor, map[string]any{"withdrawal_id": wid})
				errInfo := map[string]any{"http_status": st, "err": errString(rerr)}
				if resp != nil {
					errInfo["provider_response"] = resp
				}
				_, _ = pool.Exec(r.Context(), `UPDATE fystack_withdrawals SET status = 'provider_error', raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb WHERE id = $1`, wid, mustJSON(errInfo))
				providerMsg := extractProviderMessage(resp)
				if providerMsg == "" {
					providerMsg = "Withdrawal could not be processed right now"
				}
				playerapi.WriteError(w, http.StatusBadGateway, "provider_error", providerMsg)
				return
			} else {
				providerWid = withdrawalIDFromFystack(resp)
				log.Printf("fystack withdraw: SUCCESS wid=%s provider_wid=%s", wid, providerWid)
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
			"provider_withdrawal_id": providerWid,
			"status":                 status,
			"amount_minor":           body.AmountMinor,
			"currency":               ccy,
		})
	}
}

// resolveWithdrawAssetID finds the Fystack asset UUID for a given symbol+network
// from FYSTACK_DEPOSIT_ASSETS_JSON (same map used for deposits).
func resolveWithdrawAssetID(cfg *config.Config, symbol, network string) string {
	if cfg == nil {
		return ""
	}
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	network = config.NormalizeDepositNetwork(network)
	if symbol != "" && network != "" && cfg.FystackDepositAssets != nil {
		key := symbol + "_" + network
		if id := strings.TrimSpace(cfg.FystackDepositAssets[key]); id != "" {
			return id
		}
	}
	if id := strings.TrimSpace(cfg.FystackWithdrawAssetID); id != "" {
		return id
	}
	return ""
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

func withdrawalIDFromFystack(m map[string]any) string {
	if m == nil {
		return ""
	}
	if s, ok := m["id"].(string); ok && s != "" {
		return s
	}
	if d, ok := m["data"].(map[string]any); ok {
		if s, ok := d["id"].(string); ok && s != "" {
			return s
		}
		if s, ok := d["withdrawal_id"].(string); ok && s != "" {
			return s
		}
		if w, ok := d["withdrawal"].(map[string]any); ok {
			if s, ok := w["id"].(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

// centsToTokenAmount converts USD cents to the correct token amount string for Fystack.
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
