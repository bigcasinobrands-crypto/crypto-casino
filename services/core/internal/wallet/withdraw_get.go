package wallet

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WithdrawalGetHandler returns one PassimPay withdrawal for the authenticated player only.
func WithdrawalGetHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		id := strings.TrimSpace(chi.URLParam(r, "id"))
		if id == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "withdrawal id required")
			return
		}
		var status, currency, destination, network, providerPaymentID string
		var amount int64
		var meta []byte
		err := pool.QueryRow(r.Context(), `
			SELECT status, amount_minor, currency, COALESCE(destination_address,''),
			       COALESCE(UPPER(TRIM(network)),''), COALESCE(provider_payment_id,''),
			       COALESCE(metadata,'{}'::jsonb)
			FROM payment_withdrawals
			WHERE provider = 'passimpay' AND user_id = $2::uuid
			  AND (withdrawal_id::text = $1 OR id::text = $1 OR provider_order_id = $1)
			LIMIT 1
		`, id, uid).Scan(&status, &amount, &currency, &destination, &network, &providerPaymentID, &meta)
		if err != nil {
			if err == pgx.ErrNoRows {
				playerapi.WriteError(w, http.StatusNotFound, "not_found", "withdrawal not found")
				return
			}
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		txHash, explorerURL, errorMsg := extractWithdrawalTxFromRaw(meta, status)
		out := map[string]any{
			"id":            id,
			"status":        status,
			"amount_minor":  amount,
			"currency":      currency,
			"destination":   destination,
			"tx_hash":       txHash,
			"explorer_url":  explorerURL,
			"error_message": errorMsg,
			"provider":      "passimpay",
		}
		if network != "" {
			out["network"] = network
		}
		if providerPaymentID != "" {
			if pid, err := strconv.Atoi(strings.TrimSpace(providerPaymentID)); err == nil && pid > 0 {
				out["payment_id"] = pid
			} else {
				out["payment_id_raw"] = providerPaymentID
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func extractWithdrawalTxFromRaw(raw []byte, status string) (txHash, explorerURL, errorMsg string) {
	var m map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &m) != nil {
		return "", "", ""
	}
	txHash = firstNonEmptyStringInMap(m, "tx_hash", "transaction_hash", "txHash", "hash")
	explorerURL = firstNonEmptyStringInMap(m, "explorer_url", "explorerUrl", "block_explorer_url")
	if txHash == "" || explorerURL == "" {
		for _, sub := range m {
			sm, ok := sub.(map[string]any)
			if !ok {
				continue
			}
			if txHash == "" {
				txHash = firstNonEmptyStringInMap(sm, "tx_hash", "transaction_hash", "txHash", "hash")
			}
			if explorerURL == "" {
				explorerURL = firstNonEmptyStringInMap(sm, "explorer_url", "explorerUrl")
			}
		}
	}
	if status == "FAILED" || strings.EqualFold(status, "provider_error") {
		if pr, ok := m["provider_response"].(map[string]any); ok {
			errorMsg = firstNonEmptyStringInMap(pr, "message", "error_message", "error")
		}
		if errorMsg == "" {
			if fr, ok := m["failure_reason"].(string); ok {
				errorMsg = strings.TrimSpace(fr)
			}
		}
		if errorMsg == "" {
			errorMsg = firstNonEmptyStringInMap(m, "message", "err", "error_message")
		}
	}
	return strings.TrimSpace(txHash), strings.TrimSpace(explorerURL), strings.TrimSpace(errorMsg)
}

func firstNonEmptyStringInMap(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok {
			if t := strings.TrimSpace(s); t != "" {
				return t
			}
		}
	}
	return ""
}
