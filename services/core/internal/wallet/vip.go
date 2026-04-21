package wallet

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VIPStatusHandler returns minimal JSON for player VIP state.
func VIPStatusHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		out, err := VIPStatusMap(r.Context(), pool, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}
