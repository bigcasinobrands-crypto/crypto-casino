package blueocean

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SyncCatalog fetches getGameList (paginated when BLUEOCEAN_CATALOG_PAGE_SIZE > 0) and upserts into games.
func SyncCatalog(ctx context.Context, pool *pgxpool.Pool, client *Client, cfg *config.Config) (upserted int, err error) {
	if client == nil || !client.Configured() {
		return 0, fmt.Errorf("blueocean: client not configured")
	}
	cur := cfg.BlueOceanCurrency
	base := map[string]any{
		"currency":        cur,
		"show_systems":    1,
		"show_additional": true,
	}
	imageBase := ""
	if cfg != nil {
		imageBase = cfg.BlueOceanImageBaseURL
	}

	if cfg.BlueOceanCatalogPageSize <= 0 {
		raw, status, err := client.Call(ctx, "getGameList", base)
		if err != nil {
			_ = saveSyncState(ctx, pool, cur, 0, err.Error())
			return 0, err
		}
		if status < 200 || status >= 300 {
			_ = saveSyncState(ctx, pool, cur, 0, fmt.Sprintf("http %d", status))
			return 0, fmt.Errorf("blueocean: getGameList http %d", status)
		}
		games, err := ParseCatalogGames(raw, imageBase)
		if err != nil {
			_ = saveSyncState(ctx, pool, cur, 0, err.Error())
			return 0, err
		}
		n, err := upsertCatalogBatch(ctx, pool, cfg, games)
		if err != nil {
			_ = saveSyncState(ctx, pool, cur, 0, err.Error())
			return 0, err
		}
		_ = saveSyncState(ctx, pool, cur, n, "")
		return n, nil
	}

	pageSize := cfg.BlueOceanCatalogPageSize
	var total int
	var prevFirst int64
	var started bool
	for page := 0; page < 2000; page++ {
		p := cloneAnyMap(base)
		switch cfg.BlueOceanCatalogPagingStyle {
		case "page":
			p["page"] = page + 1
			p["per_page"] = pageSize
			p["limit"] = pageSize
		case "from":
			from := page * pageSize
			p["from"] = from
			p["to"] = from + pageSize - 1
			p["limit"] = pageSize
		default:
			p["limit"] = pageSize
			p["offset"] = page * pageSize
		}

		raw, status, err := client.Call(ctx, "getGameList", p)
		if err != nil {
			_ = saveSyncState(ctx, pool, cur, total, err.Error())
			return total, err
		}
		if status < 200 || status >= 300 {
			err := fmt.Errorf("blueocean: getGameList http %d", status)
			_ = saveSyncState(ctx, pool, cur, total, err.Error())
			return total, err
		}
		games, err := ParseCatalogGames(raw, imageBase)
		if err != nil {
			_ = saveSyncState(ctx, pool, cur, total, err.Error())
			return total, err
		}
		if len(games) == 0 {
			break
		}
		if started && games[0].BogID != 0 && games[0].BogID == prevFirst {
			log.Printf("blueocean sync: same first game id on next page — API may ignore paging (try BLUEOCEAN_CATALOG_PAGING=page or from, or BLUEOCEAN_CATALOG_PAGE_SIZE=0)")
			break
		}
		started = true
		prevFirst = games[0].BogID
		n, err := upsertCatalogBatch(ctx, pool, cfg, games)
		if err != nil {
			_ = saveSyncState(ctx, pool, cur, total, err.Error())
			return total, err
		}
		total += n
		if len(games) < pageSize {
			break
		}
	}
	_ = saveSyncState(ctx, pool, cur, total, "")
	return total, nil
}

func cloneAnyMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m)+6)
	for k, v := range m {
		out[k] = v
	}
	return out
}

func upsertCatalogBatch(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, games []CatalogGame) (int, error) {
	lobbyTagJSON := ""
	if cfg != nil {
		lobbyTagJSON = cfg.BlueOceanLobbyTagsJSON
	}
	lobbyTagMap := parseLobbyTagsJSON(lobbyTagJSON)
	n := 0
	for _, g := range games {
		id := StableGameID(g)
		cat := PrimaryLobbyKey(g.GameType)
		meta := map[string]any{
			"subcategory": g.Subcategory,
			"mobile":      g.Mobile,
			"has_jackpot": g.HasJackpot,
		}
		metaBytes, _ := json.Marshal(meta)
		tags := lobbyTagsForGame(g.IDHash, lobbyTagMap)
		_, err := pool.Exec(ctx, `
			INSERT INTO games (
				id, title, provider, category, thumbnail_url, metadata,
				bog_game_id, id_hash, game_type, provider_system, is_new,
				featurebuy_supported, play_for_fun_supported, lobby_tags, updated_at
			) VALUES (
				$1, $2, 'blueocean', $3, $4, $5::jsonb,
				$6, NULLIF($7,''), $8, NULLIF($9,''), $10,
				$11, $12, $13::text[], now()
			)
			ON CONFLICT (id) DO UPDATE SET
				title = EXCLUDED.title,
				category = EXCLUDED.category,
				thumbnail_url = EXCLUDED.thumbnail_url,
				metadata = EXCLUDED.metadata,
				bog_game_id = EXCLUDED.bog_game_id,
				id_hash = COALESCE(EXCLUDED.id_hash, games.id_hash),
				game_type = EXCLUDED.game_type,
				provider_system = EXCLUDED.provider_system,
				is_new = EXCLUDED.is_new,
				featurebuy_supported = EXCLUDED.featurebuy_supported,
				play_for_fun_supported = EXCLUDED.play_for_fun_supported,
				lobby_tags = EXCLUDED.lobby_tags,
				hidden = games.hidden,
				hidden_reason = games.hidden_reason,
				updated_at = now()
		`, id, g.Name, cat, nullStr(g.ThumbnailURL), metaBytes,
			g.BogID, g.IDHash, g.GameType, g.ProviderSystem, g.IsNew,
			g.FeatureBuySupported, g.PlayForFunSupported, tags)
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func saveSyncState(ctx context.Context, pool *pgxpool.Pool, currency string, n int, errMsg string) error {
	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO blueocean_integration_state (id, last_sync_at, last_sync_error, last_sync_upserted, last_sync_currency, updated_at)
		VALUES (1, now(), $1, $2, $3, now())
		ON CONFLICT (id) DO UPDATE SET
			last_sync_at = now(),
			last_sync_error = EXCLUDED.last_sync_error,
			last_sync_upserted = EXCLUDED.last_sync_upserted,
			last_sync_currency = EXCLUDED.last_sync_currency,
			updated_at = now()
	`, errPtr, n, currency)
	return err
}

func parseLobbyTagsJSON(raw string) map[string][]string {
	out := make(map[string][]string)
	if raw == "" {
		return out
	}
	var m map[string][]string
	if json.Unmarshal([]byte(raw), &m) == nil {
		return m
	}
	return out
}

func lobbyTagsForGame(idHash string, m map[string][]string) []string {
	if idHash == "" {
		return []string{}
	}
	var tags []string
	for pill, hashes := range m {
		for _, h := range hashes {
			if h == idHash {
				tags = append(tags, pill)
				break
			}
		}
	}
	return tags
}
