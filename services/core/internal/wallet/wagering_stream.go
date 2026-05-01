package wallet

import (
	"fmt"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WageringStreamHandler streams SSE with aggregate bonus wagering progress for the current user.
// Payload: {"wagering_remaining_minor":<int>,"active_wr_instances":<int>}.
func WageringStreamHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		lastSig := ""
		write := func() {
			ctx := r.Context()
			var wrRemaining, n int64
			_ = pool.QueryRow(ctx, `
				SELECT COALESCE(SUM(GREATEST(wr_required_minor - wr_contributed_minor, 0)), 0)::bigint
				FROM user_bonus_instances
				WHERE user_id = $1::uuid AND status IN ('active', 'pending', 'pending_review')
			`, uid).Scan(&wrRemaining)
			_ = pool.QueryRow(ctx, `
				SELECT COUNT(*)::bigint FROM user_bonus_instances
				WHERE user_id = $1::uuid AND status IN ('active', 'pending', 'pending_review')
					AND (wr_required_minor - wr_contributed_minor) > 0
			`, uid).Scan(&n)
			sig := fmt.Sprintf("%d:%d", wrRemaining, n)
			if sig == lastSig {
				return
			}
			lastSig = sig
			fmt.Fprintf(w, "data: {\"wagering_remaining_minor\":%d,\"active_wr_instances\":%d}\n\n", wrRemaining, n)
			flusher.Flush()
		}
		write()

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				write()
			}
		}
	}
}
