package wallet

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TransactionsHandler returns paginated ledger lines for the authenticated player.
func TransactionsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		limit := 50
		if s := r.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		offset := 0
		if s := r.URL.Query().Get("offset"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n >= 0 {
				offset = n
			}
		}
		rows, err := pool.Query(r.Context(), `
			SELECT id, amount_minor, currency, entry_type, idempotency_key, metadata, created_at
			FROM ledger_entries
			WHERE user_id = $1::uuid
			ORDER BY id DESC
			LIMIT $2 OFFSET $3
		`, uid, limit, offset)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var id, amt int64
			var ccy, etype, idem string
			var meta []byte
			var ct time.Time
			if err := rows.Scan(&id, &amt, &ccy, &etype, &idem, &meta, &ct); err != nil {
				continue
			}
			var metaObj any
			_ = json.Unmarshal(meta, &metaObj)
			list = append(list, map[string]any{
				"id": strconv.FormatInt(id, 10), "amount_minor": amt, "currency": ccy,
				"entry_type": etype, "idempotency_key": idem, "metadata": metaObj,
				"created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"transactions": list})
	}
}
