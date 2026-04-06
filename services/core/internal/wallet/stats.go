package wallet

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PlayerStatsHandler returns aggregate betting stats for the authenticated
// player, computed from the full ledger_entries table in a single query.
func PlayerStatsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		var totalWagered, totalWon, highestWin int64
		var totalBets int

		err := pool.QueryRow(r.Context(), `
			SELECT
				COALESCE(SUM(CASE WHEN entry_type = 'game.debit'  THEN ABS(amount_minor) ELSE 0 END), 0)::bigint  AS total_wagered,
				COALESCE(COUNT(*) FILTER (WHERE entry_type = 'game.debit'), 0)::int                               AS total_bets,
				COALESCE(SUM(CASE WHEN entry_type = 'game.credit' THEN amount_minor      ELSE 0 END), 0)::bigint  AS total_won,
				COALESCE(MAX(CASE WHEN entry_type = 'game.credit' THEN amount_minor      ELSE 0 END), 0)::bigint  AS highest_win
			FROM ledger_entries
			WHERE user_id = $1::uuid
			  AND entry_type IN ('game.debit', 'game.credit')
		`, uid).Scan(&totalWagered, &totalBets, &totalWon, &highestWin)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}

		netProfit := totalWon - totalWagered

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"total_wagered": totalWagered,
			"total_bets":    totalBets,
			"total_won":     totalWon,
			"highest_win":   highestWin,
			"net_profit":    netProfit,
		})
	}
}
