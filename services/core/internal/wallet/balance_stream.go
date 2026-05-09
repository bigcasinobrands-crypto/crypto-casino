package wallet

import (
	"fmt"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BalanceStreamHandler sends SSE events whenever the user's balance changes.
// The client receives `data: {"balance_minor":1234}\n\n` on every change.
func BalanceStreamHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
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

		ccy, multi := seamlessPlayerWalletSettings(cfg)
		lastSig := ""
		writeBal := func() {
			ctx := r.Context()
			bal, err := ledger.BalancePlayableSeamless(ctx, pool, uid, ccy, multi)
			if err != nil {
				return
			}
			cash, _ := ledger.BalanceCashSeamless(ctx, pool, uid, ccy, multi)
			bon, _ := ledger.BalanceBonusLockedSeamless(ctx, pool, uid, ccy, multi)
			sig := fmt.Sprintf("%d:%d:%d", bal, cash, bon)
			if sig == lastSig {
				return
			}
			lastSig = sig
			fmt.Fprintf(w, "data: {\"balance_minor\":%d,\"cash_minor\":%d,\"bonus_locked_minor\":%d}\n\n", bal, cash, bon)
			flusher.Flush()
		}
		writeBal()

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				writeBal()
			}
		}
	}
}
