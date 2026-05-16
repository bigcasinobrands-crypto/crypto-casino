package adminops

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/socialproof"
)

// GetRecentWins serves mixed real + synthetic recent wins for the lobby marquee (no auth).
func (h *Handler) GetRecentWins(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg := socialproof.LoadConfig(ctx, h.Pool)
	now := time.Now().UTC()
	payload, err := socialproof.BuildRecentWinPayload(ctx, h.Pool, cfg, now)
	if err != nil {
		slog.WarnContext(ctx, "recent_wins_payload_failed", "err", err)
		writeJSON(w, map[string]any{
			"enabled":              false,
			"wins":                 []any{},
			"marquee_duration_sec": 0,
			"online_count":         0,
			"refresh_after_secs":   90,
		})
		return
	}
	writeJSON(w, payload)
}
