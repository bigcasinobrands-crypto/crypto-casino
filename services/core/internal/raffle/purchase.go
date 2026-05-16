package raffle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type purchaseConfig struct {
	PricePerTicketMinor          int64 `json:"price_per_ticket_minor"`
	EveryNBuckets                int64 `json:"every_n_tickets_bucket"`
	PriceMultiplierNumerator     int64 `json:"price_multiplier_numerator"`
	MaxTicketsPerUserPerCampaign int64 `json:"max_purchase_per_user"`
}

func parsePurchaseConfig(raw []byte) purchaseConfig {
	var c purchaseConfig
	if json.Unmarshal(raw, &c) != nil || c.PricePerTicketMinor <= 0 {
		c.PricePerTicketMinor = 100
	}
	if c.PriceMultiplierNumerator <= 0 {
		c.PriceMultiplierNumerator = 2
	}
	return c
}

// PurchaseTickets debits ledger then inserts purchased ticket rows (transactional).
func PurchaseTickets(ctx context.Context, pool *pgxpool.Pool, campaignID, userID string, qty int64, walletCurrency string, idempotencyKey string) (newTotal int64, costMinor int64, err error) {
	if qty <= 0 || qty > 50000 {
		return 0, 0, fmt.Errorf("invalid quantity")
	}
	if idempotencyKey == "" {
		idempotencyKey = uuid.New().String()
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var purchaseEnabled bool
	var purchaseRaw []byte
	var status string
	err = tx.QueryRow(ctx, `
		SELECT purchase_enabled, COALESCE(purchase_config, '{}'::jsonb), status
		FROM raffle_campaigns WHERE id = $1::uuid FOR UPDATE
	`, campaignID).Scan(&purchaseEnabled, &purchaseRaw, &status)
	if err != nil {
		return 0, 0, err
	}
	if !purchaseEnabled || status != "active" {
		return 0, 0, errors.New("purchase_disabled")
	}

	pc := parsePurchaseConfig(purchaseRaw)

	var alreadyPurchased int64
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(ticket_count), 0) FROM raffle_tickets
		WHERE campaign_id = $1::uuid AND user_id = $2::uuid AND source = 'purchase' AND status = 'posted'
	`, campaignID, userID).Scan(&alreadyPurchased)

	if pc.MaxTicketsPerUserPerCampaign > 0 && alreadyPurchased+qty > pc.MaxTicketsPerUserPerCampaign {
		return 0, 0, errors.New("over_user_purchase_cap")
	}

	costMinor = computePurchaseCostMinor(pc, alreadyPurchased, qty)
	if costMinor <= 0 {
		return 0, 0, errors.New("invalid_price")
	}

	ccy := walletCurrency
	if ccy == "" {
		ccy = "USDT"
	}

	ticketIdem := "raffle:purchase:" + idempotencyKey
	ledgerIdem := fmt.Sprintf("%s:%s", ledger.EntryTypeRaffleTicketPurchaseDebit, idempotencyKey)
	ins, err := ledger.ApplyDebitTx(ctx, tx, userID, ccy, ledger.EntryTypeRaffleTicketPurchaseDebit, ledgerIdem, costMinor, map[string]any{
		"raffle_campaign_id": campaignID,
		"quantity":           qty,
	})
	if err != nil {
		return 0, 0, err
	}
	if !ins {
		_ = tx.Rollback(ctx)
		var tot int64
		_ = pool.QueryRow(ctx, `
			SELECT COALESCE(total_tickets, 0) FROM raffle_user_totals
			WHERE campaign_id = $1::uuid AND user_id = $2::uuid
		`, campaignID, userID).Scan(&tot)
		var prevCost int64
		_ = pool.QueryRow(ctx, `
			SELECT COALESCE(wager_amount_minor, 0) FROM raffle_tickets
			WHERE campaign_id = $1::uuid AND user_id = $2::uuid AND idempotency_key = $3 LIMIT 1
		`, campaignID, userID, ticketIdem).Scan(&prevCost)
		return tot, prevCost, nil
	}

	metaJ, _ := json.Marshal(map[string]any{"ledger_idempotency": ledgerIdem})
	_, err = tx.Exec(ctx, `
		INSERT INTO raffle_tickets (
		  campaign_id, user_id, ticket_count, source, source_ref_type, source_ref_id,
		  wager_amount_minor, currency, product, idempotency_key, status, metadata
		) VALUES (
		  $1::uuid, $2::uuid, $3, 'purchase', 'ledger_entry', $4,
		  $5, $6, 'purchase', $7, 'posted', $8::jsonb
		)
	`, campaignID, userID, qty, ledgerIdem, costMinor, ccy, ticketIdem, metaJ)
	if err != nil {
		return 0, 0, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO raffle_user_totals (campaign_id, user_id, total_tickets, purchased_tickets, updated_at)
		VALUES ($1::uuid, $2::uuid, $3, $3, now())
		ON CONFLICT (campaign_id, user_id) DO UPDATE SET
		  total_tickets = raffle_user_totals.total_tickets + EXCLUDED.total_tickets,
		  purchased_tickets = raffle_user_totals.purchased_tickets + EXCLUDED.purchased_tickets,
		  updated_at = now()
	`, campaignID, userID, qty)
	if err != nil {
		return 0, 0, err
	}

	var tot int64
	_ = tx.QueryRow(ctx, `SELECT total_tickets FROM raffle_user_totals WHERE campaign_id = $1::uuid AND user_id = $2::uuid`, campaignID, userID).Scan(&tot)
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return tot, costMinor, nil
}

func computePurchaseCostMinor(pc purchaseConfig, alreadyPurchased, qty int64) int64 {
	if pc.EveryNBuckets <= 0 {
		return qty * pc.PricePerTicketMinor
	}
	var sum int64
	for i := int64(0); i < qty; i++ {
		idx := alreadyPurchased + i
		bucket := idx / pc.EveryNBuckets
		price := pc.PricePerTicketMinor
		for b := int64(0); b < bucket; b++ {
			price *= pc.PriceMultiplierNumerator
		}
		sum += price
	}
	return sum
}
