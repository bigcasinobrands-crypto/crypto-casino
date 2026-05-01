package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProcessFreeSpinBogGrants claims up to `limit` rows in free_spin_grants and calls Blue Ocean
// addFreeRounds when bonus_config free_spins_v1.outbound_enabled is true, BO client is configured,
// and the game row has bog_game_id. Skips (returns 0, nil) when flag off or no work.
func ProcessFreeSpinBogGrants(ctx context.Context, pool *pgxpool.Pool, bo *blueocean.Client, cfg *config.Config, limit int) (int, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	cfgB, err := LoadFreeSpinsV1Config(ctx, pool)
	if err != nil {
		return 0, err
	}
	if !cfgB.OutboundEnabled {
		return 0, nil
	}
	_ = resetStuckFreeSpinInProgress(ctx, pool)

	if bo == nil || !bo.Configured() {
		// Do not mark rows as error: operator may turn on after configuring BO.
		return 0, nil
	}
	n := 0
	for i := 0; i < limit; i++ {
		did, err := processOneFreeSpinBog(ctx, pool, bo, cfg)
		if err != nil {
			return n, err
		}
		if did {
			n++
		} else {
			break
		}
	}
	return n, nil
}

func resetStuckFreeSpinInProgress(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		UPDATE free_spin_grants
		SET status = 'pending', updated_at = now()
		WHERE status = 'in_progress' AND updated_at < now() - interval '30 minutes'
	`)
	return err
}

type freeSpinRow struct {
	ID         string
	UserID     string
	GameIDKey  string
	BetMinor   int64
	Rounds     int
	Metadata   []byte
}

func processOneFreeSpinBog(ctx context.Context, pool *pgxpool.Pool, bo *blueocean.Client, cfg *config.Config) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var r freeSpinRow
	err = tx.QueryRow(ctx, `
		WITH c AS (
			SELECT id
			FROM free_spin_grants
			WHERE status = 'pending'
			  AND TRIM(COALESCE(game_id, '')) <> ''
			  AND rounds_total > 0
			ORDER BY created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE free_spin_grants f
		SET status = 'in_progress', updated_at = now()
		FROM c
		WHERE f.id = c.id
		RETURNING f.id::text, f.user_id::text, f.game_id, f.bet_minor, f.rounds_total, f.metadata
	`).Scan(&r.ID, &r.UserID, &r.GameIDKey, &r.BetMinor, &r.Rounds, &r.Metadata)
	if err == pgx.ErrNoRows {
		_ = tx.Rollback(ctx)
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}

	gkey := strings.TrimSpace(r.GameIDKey)
	bogID, berr := resolveBogGameID(ctx, pool, gkey)
	if berr != nil {
		obs.AddFreeSpinBogError(1)
		return true, markFreeSpinError(ctx, pool, r.ID, berr.Error())
	}
	remote, rerr := resolveBogRemoteUserID(ctx, pool, r.UserID)
	if rerr != nil {
		obs.AddFreeSpinBogError(1)
		return true, markFreeSpinError(ctx, pool, r.ID, rerr.Error())
	}
	title := freeSpinTitleFromMetadata(r.Metadata, r.ID)
	ares := bo.AddFreeRounds(ctx, cfg, blueocean.AddFreeRoundsRequest{
		Title:  title,
		UserID: remote,
		GameID: bogID,
		Rounds: r.Rounds,
	})
	if !ares.OK {
		obs.AddFreeSpinBogError(1)
		errStr := ares.ErrorMessage
		if errStr == "" {
			errStr = "addFreeRounds failed"
		}
		if err2 := markFreeSpinError(ctx, pool, r.ID, errStr); err2 != nil {
			return true, err2
		}
		return true, nil
	}
	ref := strings.TrimSpace(ares.ProviderRef)
	if err := markFreeSpinGranted(ctx, pool, r.ID, ref); err != nil {
		return true, err
	}
	obs.AddFreeSpinBogGranted(1)
	return true, nil
}

func resolveBogGameID(ctx context.Context, pool *pgxpool.Pool, key string) (int64, error) {
	if key == "" {
		return 0, fmt.Errorf("missing game_id")
	}
	var bog int64
	err := pool.QueryRow(ctx, `
		SELECT bog_game_id FROM games
		WHERE (id = $1 OR id_hash = $1) AND bog_game_id IS NOT NULL AND bog_game_id > 0
		LIMIT 1
	`, key).Scan(&bog)
	if err == pgx.ErrNoRows {
		return 0, fmt.Errorf("no blueocean catalog id (bog_game_id) for game %q; sync catalog or set game_id to a known games.id", key)
	}
	if err != nil {
		return 0, err
	}
	return bog, nil
}

func resolveBogRemoteUserID(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	var remote string
	err := pool.QueryRow(ctx, `SELECT remote_player_id FROM blueocean_player_links WHERE user_id = $1::uuid`, userID).Scan(&remote)
	if err == nil && strings.TrimSpace(remote) != "" {
		return strings.TrimSpace(remote), nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	// same default as game launch: UUID string until a BO session creates a link
	return userID, nil
}

func shortID(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}

func freeSpinTitleFromMetadata(raw []byte, grantID string) string {
	sid := shortID(grantID)
	if len(raw) == 0 {
		return "Free rounds " + sid
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return "Free rounds " + sid
	}
	if t, _ := m["title"].(string); strings.TrimSpace(t) != "" {
		return strings.TrimSpace(t)
	}
	return "Free rounds " + sid
}

func markFreeSpinGranted(ctx context.Context, pool *pgxpool.Pool, id, providerRef string) error {
	ref := strings.TrimSpace(providerRef)
	_, err := pool.Exec(ctx, `
		UPDATE free_spin_grants
		SET status = 'granted', provider = 'blueocean', provider_ref = NULLIF($2, ''), updated_at = now()
		WHERE id = $1::uuid
	`, id, ref)
	return err
}

func markFreeSpinError(ctx context.Context, pool *pgxpool.Pool, id, errMsg string) error {
	payload, _ := json.Marshal(map[string]string{
		"at":     time.Now().UTC().Format(time.RFC3339),
		"source": "blueocean_addFreeRounds",
		"error":  errMsg,
	})
	_, err := pool.Exec(ctx, `
		UPDATE free_spin_grants
		SET status = 'error', updated_at = now(),
			metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
		WHERE id = $1::uuid
	`, id, payload)
	return err
}
