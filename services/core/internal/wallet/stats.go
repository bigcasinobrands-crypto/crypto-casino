package wallet

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QueryPlayerBettingTotals returns ledger aggregates for profile stats and game-history summaries.
// Counts distinct bet rounds when BlueOcean splits a stake into bonus + cash debits (same metadata txn).
func QueryPlayerBettingTotals(ctx context.Context, pool *pgxpool.Pool, uid string) (
	totalWagered int64,
	totalBets int,
	totalWon int64,
	highestWin int64,
	winLineCount int,
	err error,
) {
	err = pool.QueryRow(ctx, `
			WITH game_lines AS (
				SELECT entry_type, amount_minor, metadata
				FROM ledger_entries
				WHERE user_id = $1::uuid
				  AND entry_type IN ('game.debit', 'game.credit', 'game.bet', 'game.win', 'game.rollback')
			)
			SELECT
				GREATEST(COALESCE(SUM(CASE
					WHEN entry_type IN ('game.debit', 'game.bet') THEN ABS(amount_minor)
					WHEN entry_type = 'game.rollback' THEN -ABS(amount_minor)
					ELSE 0 END), 0), 0)::bigint,
				COALESCE((
					SELECT COUNT(*)::int FROM (
						SELECT 1
						FROM game_lines g
						WHERE g.entry_type IN ('game.debit', 'game.bet')
						  AND COALESCE(g.metadata->>'txn', '') <> ''
						GROUP BY COALESCE(g.metadata->>'remote_id', ''), g.metadata->>'txn'
					) t
				), 0)
				+ COALESCE((
					SELECT COUNT(*)::int FROM game_lines g
					WHERE g.entry_type IN ('game.debit', 'game.bet')
					  AND COALESCE(g.metadata->>'txn', '') = ''
				), 0),
				COALESCE(SUM(CASE
					WHEN entry_type IN ('game.credit', 'game.win') THEN amount_minor
					ELSE 0 END), 0)::bigint,
				COALESCE(MAX(CASE
					WHEN entry_type IN ('game.credit', 'game.win') THEN amount_minor
					ELSE NULL END), 0)::bigint,
				COALESCE(COUNT(*) FILTER (WHERE entry_type IN ('game.credit', 'game.win')), 0)::int
			FROM game_lines
	`, uid).Scan(&totalWagered, &totalBets, &totalWon, &highestWin, &winLineCount)
	return totalWagered, totalBets, totalWon, highestWin, winLineCount, err
}

// PlayerStatsHandler returns aggregate betting stats for the authenticated
// player, computed from the full ledger_entries table in a single query.
func PlayerStatsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		totalWagered, totalBets, totalWon, highestWin, _, err := QueryPlayerBettingTotals(r.Context(), pool, uid)
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
