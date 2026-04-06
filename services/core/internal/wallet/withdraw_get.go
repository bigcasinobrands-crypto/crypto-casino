package wallet

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WithdrawalGetHandler returns one withdrawal for the authenticated player only.
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
		var userID, status, currency, destination string
		var amount int64
		var raw []byte
		err := pool.QueryRow(r.Context(), `
			SELECT user_id::text, status, amount_minor, currency, COALESCE(destination,''), COALESCE(raw, '{}'::jsonb)
			FROM fystack_withdrawals WHERE id = $1
		`, id).Scan(&userID, &status, &amount, &currency, &destination, &raw)
		if err != nil {
			if err == pgx.ErrNoRows {
				playerapi.WriteError(w, http.StatusNotFound, "not_found", "withdrawal not found")
				return
			}
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		if userID != uid {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "withdrawal not found")
			return
		}
		txHash, explorerURL, errorMsg := extractWithdrawalTxFromRaw(raw, status)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":            id,
			"status":        status,
			"amount_minor":  amount,
			"currency":      currency,
			"destination":   destination,
			"tx_hash":       txHash,
			"explorer_url":  explorerURL,
			"error_message": errorMsg,
		})
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
	if status == "provider_error" || status == "failed" {
		if pr, ok := m["provider_response"].(map[string]any); ok {
			errorMsg = firstNonEmptyStringInMap(pr, "message", "error_message", "error")
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
