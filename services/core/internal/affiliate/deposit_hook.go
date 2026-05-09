package affiliate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// OnDepositCreditedTx accrues instant referral commissions when deposit.credit is
// first applied for a referee. Runs inside the deposit transaction.
// Caller must pass the same idempotency key used for the player's deposit.credit line.
func OnDepositCreditedTx(ctx context.Context, tx pgx.Tx, refereeUserID, currency string, depositMinor int64, depositIdempotencyKey string) error {
	if tx == nil || depositMinor <= 0 || strings.TrimSpace(refereeUserID) == "" {
		return nil
	}
	cur := strings.ToUpper(strings.TrimSpace(currency))

	var partnerID, partnerUserID string
	var cpa *int64
	var depBps *int32
	err := tx.QueryRow(ctx, `
		SELECT p.id::text, p.user_id::text,
		       t.first_deposit_cpa_minor,
		       t.deposit_revshare_bps
		FROM affiliate_referrals ar
		JOIN affiliate_partners p ON p.id = ar.partner_id AND p.status = 'active'
		LEFT JOIN referral_program_tiers t ON t.id = p.tier_id AND t.active
		WHERE ar.user_id = $1::uuid
	`, refereeUserID).Scan(&partnerID, &partnerUserID, &cpa, &depBps)
	if err != nil {
		return nil // not referred — not an error
	}

	// Deposit rev-share on gross deposit
	if depBps != nil && *depBps > 0 {
		comm := depositMinor * int64(*depBps) / 10_000
		if comm > 0 {
			period := fmt.Sprintf("instant:dep:%s", depositIdempotencyKey)
			if err := postInstantGrantTx(ctx, tx, partnerID, partnerUserID, cur, period, comm, map[string]any{
				"kind":                "deposit_revshare",
				"referee_user_id":     refereeUserID,
				"deposit_minor":       depositMinor,
				"deposit_revshare_bps": *depBps,
				"deposit_idem":       depositIdempotencyKey,
			}); err != nil {
				return err
			}
		}
	}

	// CPA — first successful deposit only
	if cpa != nil && *cpa > 0 {
		var n int64
		_ = tx.QueryRow(ctx, `
			SELECT COUNT(*)::bigint FROM ledger_entries
			WHERE user_id = $1::uuid AND entry_type = 'deposit.credit' AND amount_minor > 0
		`, refereeUserID).Scan(&n)
		if n == 1 {
			period := fmt.Sprintf("instant:cpa:%s", refereeUserID)
			if err := postInstantGrantTx(ctx, tx, partnerID, partnerUserID, cur, period, *cpa, map[string]any{
				"kind":            "first_deposit_cpa",
				"referee_user_id": refereeUserID,
				"deposit_idem":    depositIdempotencyKey,
			}); err != nil {
				return err
			}
		}
	}

	return nil
}

func postInstantGrantTx(ctx context.Context, tx pgx.Tx, partnerID, partnerUserID, currency, accrualPeriod string, commissionMinor int64, meta map[string]any) error {
	if commissionMinor <= 0 {
		return nil
	}
	metaJSON := "{}"
	if meta != nil {
		b, err := json.Marshal(meta)
		if err == nil {
			metaJSON = string(b)
		}
	}

	var grantID string
	err := tx.QueryRow(ctx, `
		INSERT INTO affiliate_commission_grants (
			partner_id, accrual_period, currency, referred_user_count,
			referred_ngr_minor, commission_minor, status, metadata
		)
		VALUES ($1::uuid, $2, $3, 1, 0, $4, 'pending', $5::jsonb)
		ON CONFLICT (partner_id, accrual_period, currency) DO NOTHING
		RETURNING id::text
	`, partnerID, accrualPeriod, currency, commissionMinor, metaJSON).Scan(&grantID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("affiliate instant grant: %w", err)
	}

	idem := fmt.Sprintf("affiliate:instant:%s:%s", accrualPeriod, currency)
	_, err = ledger.ApplyCreditWithPocketTx(ctx, tx, partnerUserID, currency,
		ledger.EntryTypeAffiliateCommission, idem, 0, ledger.PocketCash, map[string]any{
			"grant_id":         grantID,
			"accrual_period":   accrualPeriod,
			"commission_minor": commissionMinor,
		})
	if err != nil {
		return fmt.Errorf("affiliate instant ledger marker: %w", err)
	}
	return nil
}
