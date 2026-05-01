package wallet

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VIPRakebackBoostClaimHandler POST /v1/vip/rakeback-boost/claim
func VIPRakebackBoostClaimHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		now := time.Now().UTC()
		st, err := bonus.ClaimRakebackBoostForUser(r.Context(), pool, uid, now)
		if err != nil {
			switch {
			case errors.Is(err, bonus.ErrRakebackBoostNoTier), errors.Is(err, bonus.ErrRakebackBoostNoConfig):
				playerapi.WriteError(w, http.StatusNotFound, "not_configured", "rakeback boost not configured")
			case errors.Is(err, bonus.ErrRakebackBoostAlreadyActive):
				playerapi.WriteError(w, http.StatusConflict, "already_active", "rakeback boost already active")
			case errors.Is(err, bonus.ErrRakebackBoostDailyLimit):
				playerapi.WriteError(w, http.StatusConflict, "daily_limit_reached", "daily rakeback boost limit reached")
			case errors.Is(err, bonus.ErrRakebackBoostNotClaimableNow):
				playerapi.WriteError(w, http.StatusConflict, "window_closed", "rakeback boost claim window is closed")
			default:
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "claim failed")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":     true,
			"status": st,
		})
	}
}
