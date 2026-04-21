package wallet

import (
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxSessionMinutes = 120.0

// GameHistoryHandler returns per-game stats for the authenticated player:
// sessions played, estimated avg session duration, first/last played, and
// aggregate wager stats from ledger game.debit|game.bet / game.credit|game.win entries.
func GameHistoryHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}

		// Per-game launch stats
		rows, err := pool.Query(r.Context(), `
			SELECT
				gl.game_id,
				g.title,
				COALESCE(g.category, ''),
				COALESCE(g.thumbnail_url, ''),
				COALESCE(g.provider, ''),
				COUNT(*)::int             AS sessions,
				MIN(gl.created_at)        AS first_played,
				MAX(gl.created_at)        AS last_played
			FROM game_launches gl
			JOIN games g ON g.id = gl.game_id
			WHERE gl.user_id = $1::uuid
			GROUP BY gl.game_id, g.title, g.category, g.thumbnail_url, g.provider
			ORDER BY COUNT(*) DESC, MAX(gl.created_at) DESC
		`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()

		var games []map[string]any
		for rows.Next() {
			var gameID, title, category, thumb, provider string
			var sessions int
			var first, last time.Time
			if err := rows.Scan(&gameID, &title, &category, &thumb, &provider, &sessions, &first, &last); err != nil {
				continue
			}
			games = append(games, map[string]any{
				"game_id":       gameID,
				"title":         title,
				"category":      category,
				"thumbnail_url": thumb,
				"provider":      provider,
				"sessions":      sessions,
				"first_played":  first.UTC().Format(time.RFC3339),
				"last_played":   last.UTC().Format(time.RFC3339),
			})
		}

		// Estimate avg session duration per game from consecutive launch gaps
		sessionRows, err := pool.Query(r.Context(), `
			WITH ordered AS (
				SELECT
					game_id,
					created_at,
					LEAD(created_at) OVER (ORDER BY created_at) AS next_launch
				FROM game_launches
				WHERE user_id = $1::uuid
			)
			SELECT
				game_id,
				COALESCE(AVG(
					LEAST(EXTRACT(EPOCH FROM (next_launch - created_at)) / 60.0, $2::float8)
				) FILTER (WHERE next_launch IS NOT NULL), 0)::float8 AS avg_mins
			FROM ordered
			GROUP BY game_id
		`, uid, maxSessionMinutes)
		if err == nil {
			defer sessionRows.Close()
			avgMap := map[string]float64{}
			for sessionRows.Next() {
				var gid string
				var avg float64
				if err := sessionRows.Scan(&gid, &avg); err == nil {
					avgMap[gid] = math.Round(avg*10) / 10
				}
			}
			for _, g := range games {
				gid := g["game_id"].(string)
				if v, ok := avgMap[gid]; ok {
					g["avg_session_mins"] = v
				} else {
					g["avg_session_mins"] = 0.0
				}
			}
		}

		// Aggregate wager stats (same rules as GET /v1/wallet/stats)
		totalWagered, totalBets, totalWon, _, totalWins, err := QueryPlayerBettingTotals(r.Context(), pool, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "ledger stats failed")
			return
		}

		if games == nil {
			games = []map[string]any{}
		}

		totalSessions := 0
		for _, g := range games {
			totalSessions += g["sessions"].(int)
		}

		avgWager := int64(0)
		if totalBets > 0 {
			avgWager = totalWagered / int64(totalBets)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"games":          games,
			"total_sessions": totalSessions,
			"total_wagered":  totalWagered,
			"total_won":      totalWon,
			"total_bets":     totalBets,
			"total_wins":     totalWins,
			"avg_wager":      avgWager,
		})
	}
}
