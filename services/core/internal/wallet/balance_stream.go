package wallet

import (
	"fmt"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BalanceStreamHandler sends SSE events whenever the user's balance changes.
// The client receives `data: {"balance_minor":1234}\n\n` on every change.
func BalanceStreamHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		// Send initial balance immediately
		var lastBalance int64 = -1
		if bal, err := ledger.BalanceMinor(r.Context(), pool, uid); err == nil {
			lastBalance = bal
			fmt.Fprintf(w, "data: {\"balance_minor\":%d}\n\n", bal)
			flusher.Flush()
		}

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				bal, err := ledger.BalanceMinor(r.Context(), pool, uid)
				if err != nil {
					continue
				}
				if bal != lastBalance {
					lastBalance = bal
					fmt.Fprintf(w, "data: {\"balance_minor\":%d}\n\n", bal)
					flusher.Flush()
				}
			}
		}
	}
}
