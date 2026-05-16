package raffle

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PayoutWinner credits cash raffle prizes through the ledger (idempotent via ledger_idempotency_key).
func PayoutWinner(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, winnerID string) error {
	_ = cfg
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var uid, ccy, ptype, payout string
	var amount int64
	var ledgerIdem string
	var campaignID, drawID string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, prize_currency, prize_type, payout_status, prize_amount_minor,
		       ledger_idempotency_key, campaign_id::text, draw_id::text
		FROM raffle_winners WHERE id = $1::uuid FOR UPDATE
	`, winnerID).Scan(&uid, &ccy, &ptype, &payout, &amount, &ledgerIdem, &campaignID, &drawID)
	if err != nil {
		return err
	}
	if payout == "paid" || payout == "skipped" {
		return nil
	}
	if ptype != "cash" || amount <= 0 {
		return fmt.Errorf("payout_not_auto")
	}
	meta := map[string]any{
		"raffle_campaign_id": campaignID,
		"raffle_draw_id":     drawID,
		"raffle_winner_id":   winnerID,
	}
	_, err = ledger.ApplyCreditTx(ctx, tx, uid, ccy, ledger.EntryTypeRafflePrizeCredit, ledgerIdem, amount, meta)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE raffle_winners SET payout_status = 'paid', paid_at = now()
		WHERE id = $1::uuid AND payout_status <> 'paid'
	`, winnerID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PayoutCampaignWinners pays all pending cash winners for a draw.
func PayoutCampaignWinners(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, campaignID, drawID string) (paid int, err error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text FROM raffle_winners
		WHERE campaign_id = $1::uuid AND draw_id = $2::uuid
		  AND payout_status = 'pending' AND prize_type = 'cash' AND prize_amount_minor > 0
		ORDER BY rank_slot ASC
	`, campaignID, drawID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return paid, err
		}
		ids = append(ids, id)
	}
	for _, id := range ids {
		if err := PayoutWinner(ctx, pool, cfg, id); err != nil {
			return paid, err
		}
		paid++
	}
	return paid, nil
}

// AppendWinnerMetadata merges JSON into raffle_winners.metadata (best-effort).
func AppendWinnerMetadata(ctx context.Context, pool *pgxpool.Pool, winnerID string, patch map[string]any) {
	b, err := json.Marshal(patch)
	if err != nil {
		return
	}
	_, _ = pool.Exec(ctx, `
		UPDATE raffle_winners SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid
	`, winnerID, b)
}
