package games

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type row struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Provider     string `json:"provider"`
	Category     string `json:"category"`
	ThumbnailURL string `json:"thumbnail_url"`
}

func ListHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := pool.Query(r.Context(), `
			SELECT id, title, provider, COALESCE(category,''), COALESCE(thumbnail_url,'')
			FROM games ORDER BY title
		`)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var out []row
		for rows.Next() {
			var g row
			if err := rows.Scan(&g.ID, &g.Title, &g.Provider, &g.Category, &g.ThumbnailURL); err != nil {
				continue
			}
			out = append(out, g)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"games": out})
	}
}

type launchReq struct {
	GameID string `json:"game_id"`
}

// LaunchHandler returns a launch URL (replace with BlueOcean seamless launch when credentialed).
func LaunchHandler(baseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body launchReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.GameID == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "game_id required")
			return
		}
		base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
		if base == "" {
			base = "https://example.invalid/blueocean/play"
		}
		uid, _ := playerapi.UserIDFromContext(r.Context())
		url := base + "?game=" + body.GameID + "&uid=" + uid
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"url": url, "mode": "iframe"})
	}
}

func LaunchBaseFromEnv() string {
	return strings.TrimSpace(os.Getenv("GAME_LAUNCH_BASE_URL"))
}
