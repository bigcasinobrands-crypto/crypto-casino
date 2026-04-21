// Package bonusblueocean is a feature-flagged stub for mapping internal promotions to BlueOcean XAPI.
// Enable with BLUEOCEAN_BONUS_SYNC_ENABLED=true after BO method names are confirmed.
package bonusblueocean

import (
	"context"
	"encoding/json"
	"log"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SyncPromotionVersionDryRun logs the mapping that would be sent; does not call BO unless forced.
func SyncPromotionVersionDryRun(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, bog *blueocean.Client, versionID int64) error {
	if cfg == nil || !cfg.BlueOceanBonusSyncEnabled || bog == nil || !bog.Configured() {
		return nil
	}
	var rules []byte
	err := pool.QueryRow(ctx, `SELECT rules FROM promotion_versions WHERE id = $1`, versionID).Scan(&rules)
	if err != nil {
		return err
	}
	var m map[string]any
	_ = json.Unmarshal(rules, &m)
	log.Printf("bonusblueocean dry-run: version_id=%d rules_keys=%v (no outbound call)", versionID, keysOf(m))
	return nil
}

func keysOf(m map[string]any) []string {
	var k []string
	for x := range m {
		k = append(k, x)
	}
	return k
}
