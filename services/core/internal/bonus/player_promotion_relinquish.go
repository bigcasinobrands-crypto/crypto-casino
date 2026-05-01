package bonus

import (
	"context"
	"errors"
	"fmt"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RelinquishSource is how a player was excluded from a promotion_version going forward.
const (
	RelinquishForfeit     = "forfeit"
	RelinquishCancelIntent = "cancel_intent"
)

// RecordPlayerPromotionRelinquishment records that the player will not be offered this
// promotion version in available-offer lists (forfeit of credited bonus or cancel of deposit intent).
func RecordPlayerPromotionRelinquishment(ctx context.Context, pool *pgxpool.Pool, userID string, promotionVersionID int64, source string) error {
	if userID == "" || promotionVersionID <= 0 {
		return nil
	}
	if source == "" {
		source = RelinquishForfeit
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO player_promotion_relinquishments (user_id, promotion_version_id, source)
		VALUES ($1::uuid, $2, $3)
		ON CONFLICT (user_id, promotion_version_id) DO UPDATE SET
			source = EXCLUDED.source,
			created_at = now()
	`, userID, promotionVersionID, source)
	if err != nil {
		return fmt.Errorf("bonus: record relinquishment: %w", err)
	}
	return nil
}

func loadRelinquishedPromotionVersionIDs(ctx context.Context, pool *pgxpool.Pool, userID string) (map[int64]struct{}, error) {
	rows, err := pool.Query(ctx, `
		SELECT promotion_version_id FROM player_promotion_relinquishments WHERE user_id = $1::uuid
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64]struct{})
	for rows.Next() {
		var pvid int64
		if err := rows.Scan(&pvid); err != nil {
			continue
		}
		out[pvid] = struct{}{}
	}
	return out, rows.Err()
}

// CancelPlayerDepositIntentWithRelinquishment atomically records relinquishment and clears
// the deposit intent so listing and deposit evaluation stay consistent.
func CancelPlayerDepositIntentWithRelinquishment(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	if userID == "" {
		return nil
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var pvid int64
	err = tx.QueryRow(ctx, `SELECT promotion_version_id FROM player_bonus_deposit_intents WHERE user_id = $1::uuid`, userID).Scan(&pvid)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO player_promotion_relinquishments (user_id, promotion_version_id, source)
		VALUES ($1::uuid, $2, $3)
		ON CONFLICT (user_id, promotion_version_id) DO UPDATE SET
			source = EXCLUDED.source,
			created_at = now()
	`, userID, pvid, RelinquishCancelIntent)
	if err != nil {
		return fmt.Errorf("bonus: record relinquishment: %w", err)
	}
	_, err = tx.Exec(ctx, `DELETE FROM player_bonus_deposit_intents WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	idem := fmt.Sprintf("promo.relinquish:cancel_intent:%s:%d", userID, pvid)
	_, _ = ledger.RecordNonBalanceEvent(ctx, pool, userID, "USDT", "promo.relinquish", idem, map[string]any{
		"promotion_version_id": pvid,
		"source":               RelinquishCancelIntent,
	})
	return nil
}
