package adminops

import (
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/socialproof"
)

// GetSocialProof exposes CMS-tuned sidebar stats for the player shell (no auth).
func (h *Handler) GetSocialProof(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg := socialproof.LoadConfig(ctx, h.Pool)
	now := time.Now().UTC()

	if !cfg.Enabled {
		writeJSON(w, map[string]any{
			"enabled": false,
		})
		return
	}

	realMinor, err := socialproof.TotalWageredStakeMinor(ctx, h.Pool)
	if err != nil {
		writeJSON(w, map[string]any{"enabled": false})
		return
	}

	displayMinor := socialproof.DisplayWageredMinor(realMinor, cfg)
	online := socialproof.ComputeOnline(now, cfg)
	until := socialproof.BucketUntilUnix(now, cfg)

	writeJSON(w, map[string]any{
		"enabled":                  true,
		"online_count":             online,
		"bets_wagered_display_minor": displayMinor,
		"online_bucket_until_unix": until,
		"online_bucket_secs":       cfg.OnlineBucketSecs,
	})
}
