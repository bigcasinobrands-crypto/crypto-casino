package playerfavourites

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Mount registers /me/favourite-games routes on r (caller must apply Bearer auth).
func Mount(r chi.Router, pool *pgxpool.Pool) {
	r.Get("/me/favourite-games", listHandler(pool))
	r.Put("/me/favourite-games", putHandler(pool))
	r.Post("/me/favourite-games", postHandler(pool))
	r.Delete("/me/favourite-games/{gameID}", deleteHandler(pool))
}

func listHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		ctx := r.Context()
		rows, err := pool.Query(ctx, `
SELECT game_id FROM player_favourite_games
WHERE user_id = $1
ORDER BY created_at DESC`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "list favourites failed")
			return
		}
		defer rows.Close()
		var ids []string
		for rows.Next() {
			var gid string
			if err := rows.Scan(&gid); err != nil {
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "list favourites failed")
				return
			}
			if gid != "" {
				ids = append(ids, gid)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"game_ids": ids})
	}
}

type putBody struct {
	GameIDs []string `json:"game_ids"`
}

func putHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		var body putBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
			return
		}
		// Dedupe preserving order
		seen := make(map[string]struct{})
		var ids []string
		for _, raw := range body.GameIDs {
			gid := strings.TrimSpace(raw)
			if gid == "" {
				continue
			}
			if _, dup := seen[gid]; dup {
				continue
			}
			seen[gid] = struct{}{}
			ids = append(ids, gid)
		}

		ctx := r.Context()
		tx, err := pool.Begin(ctx)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "transaction failed")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()

		if _, err := tx.Exec(ctx, `DELETE FROM player_favourite_games WHERE user_id = $1`, uid); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "save favourites failed")
			return
		}
		if len(ids) > 0 {
			_, err = tx.Exec(ctx, `
INSERT INTO player_favourite_games (user_id, game_id, created_at)
SELECT $1::uuid, g.id, clock_timestamp() + (t.ord * interval '1 microsecond')
FROM unnest($2::text[]) WITH ORDINALITY AS t(gid, ord)
INNER JOIN games g ON g.id = t.gid
ON CONFLICT (user_id, game_id) DO UPDATE SET created_at = EXCLUDED.created_at`, uid, ids)
			if err != nil {
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "save favourites failed")
				return
			}
		}
		if err := tx.Commit(ctx); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "save favourites failed")
			return
		}

		// Return canonical ordered list
		rows, err := pool.Query(ctx, `
SELECT game_id FROM player_favourite_games WHERE user_id = $1 ORDER BY created_at DESC`, uid)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"game_ids": ids})
			return
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var gid string
			if err := rows.Scan(&gid); err != nil {
				break
			}
			if gid != "" {
				out = append(out, gid)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"game_ids": out})
	}
}

type postBody struct {
	GameID string `json:"game_id"`
}

func postHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		var body postBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
			return
		}
		gid := strings.TrimSpace(body.GameID)
		if gid == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_game", "game_id required")
			return
		}
		ctx := r.Context()
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM games WHERE id = $1)`, gid).Scan(&exists); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "favourite add failed")
			return
		}
		if !exists {
			playerapi.WriteError(w, http.StatusBadRequest, "unknown_game", "game not found")
			return
		}
		_, err := pool.Exec(ctx, `
INSERT INTO player_favourite_games (user_id, game_id) VALUES ($1::uuid, $2)
ON CONFLICT (user_id, game_id) DO NOTHING`, uid, gid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "favourite add failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "game_id": gid})
	}
}

func deleteHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		gid := strings.TrimSpace(chi.URLParam(r, "gameID"))
		if gid == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_game", "game id required")
			return
		}
		ctx := r.Context()
		_, err := pool.Exec(ctx, `DELETE FROM player_favourite_games WHERE user_id = $1 AND game_id = $2`, uid, gid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "favourite remove failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}
