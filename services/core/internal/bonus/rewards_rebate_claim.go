package bonus

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrRakebackNothingToClaim when there is no pending_wallet balance.
	ErrRakebackNothingToClaim = errors.New("rewards: no rakeback to claim")
	// ErrRakebackClaimBlocked when user is self-excluded / risk blocked.
	ErrRakebackClaimBlocked = errors.New("rewards: rakeback claim blocked")
)

// PendingRakebackWalletSummary returns aggregated pending rakeback for the wallet-claim path.
func PendingRakebackWalletSummary(ctx context.Context, pool *pgxpool.Pool, userID string) (totalMinor int64, periods int, err error) {
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(grant_amount_minor), 0)::bigint, COUNT(*)::int
		FROM reward_rebate_grants
		WHERE user_id = $1::uuid AND payout_status = 'pending_wallet'
	`, userID).Scan(&totalMinor, &periods)
	return totalMinor, periods, err
}

// ClaimPendingRakebackWallet pays pending rakeback via treasury transfer and syncs ledger cash (idempotent per grant id).
func ClaimPendingRakebackWallet(ctx context.Context, pool *pgxpool.Pool, userID, currency string) (paidMinor int64, err error) {
	if currency == "" {
		currency = "USDT"
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return 0, err
	}
	if !bf.BonusesEnabled {
		return 0, ErrBonusesDisabled
	}
	if userRebateBlocked(ctx, pool, userID) {
		return 0, ErrRakebackClaimBlocked
	}

	rows, err := pool.Query(ctx, `
		SELECT id, grant_amount_minor, reward_program_id, period_key
		FROM reward_rebate_grants
		WHERE user_id = $1::uuid AND payout_status = 'pending_wallet'
		ORDER BY id ASC
	`, userID)
	if err != nil {
		return 0, err
	}
	type grantRow struct {
		id       int64
		amount   int64
		progID   int64
		period   string
	}
	var list []grantRow
	for rows.Next() {
		var g grantRow
		if err := rows.Scan(&g.id, &g.amount, &g.progID, &g.period); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(list) == 0 {
		return 0, ErrRakebackNothingToClaim
	}

	var paid int64
	var nPositive int
	for _, g := range list {
		if g.amount <= 0 {
			continue
		}
		nPositive++
		idem := fmt.Sprintf("promo:rakeback:wallet:%d", g.id)
		meta := map[string]any{
			"reward_program_id": g.progID,
			"period_key":        g.period,
			"rebate_grant_id":   g.id,
		}
		inserted, err := PayoutAndCreditCash(ctx, pool, userID, currency, "promo.rakeback", idem, g.amount, meta)
		if err != nil {
			return 0, err
		}
		tag, err := pool.Exec(ctx, `
			UPDATE reward_rebate_grants
			SET payout_status = 'wallet_paid'
			WHERE id = $1 AND payout_status = 'pending_wallet'
		`, g.id)
		if err != nil {
			return 0, err
		}
		if tag.RowsAffected() > 1 {
			return 0, fmt.Errorf("rebate grant row out of sync id=%d", g.id)
		}
		if inserted {
			paid += g.amount
		}
	}

	if nPositive == 0 {
		return 0, ErrRakebackNothingToClaim
	}
	return paid, nil
}

// RakebackClaimStatusForAPI is nested under vip for GET /v1/vip/status and hub.
type RakebackClaimStatusForAPI struct {
	ClaimableMinor  int64 `json:"claimable_minor"`
	PendingPeriods  int   `json:"pending_periods"`
	ClaimableNow    bool  `json:"claimable_now"`
	BlockReason     string `json:"block_reason,omitempty"`
}

// RakebackClaimStatusForUser aggregates pending wallet rakeback for API payloads (VIP status, hub).
func RakebackClaimStatusForUser(ctx context.Context, pool *pgxpool.Pool, userID string) (RakebackClaimStatusForAPI, error) {
	var st RakebackClaimStatusForAPI
	sum, n, err := PendingRakebackWalletSummary(ctx, pool, userID)
	if err != nil {
		return st, err
	}
	st.ClaimableMinor = sum
	st.PendingPeriods = n
	if sum <= 0 {
		return st, nil
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return st, err
	}
	if !bf.BonusesEnabled {
		st.BlockReason = "bonuses_disabled"
		return st, nil
	}
	if userRebateBlocked(ctx, pool, userID) {
		st.BlockReason = "account_restricted"
		return st, nil
	}
	st.ClaimableNow = true
	return st, nil
}
