package bonus

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ChallengeGrantArgs credits bonus_locked for a challenge prize (no promotion_versions row).
type ChallengeGrantArgs struct {
	UserID                  string
	ChallengeEntryID        string
	ChallengeID             string
	ChallengeTitle          string
	IdempotencyKey          string
	GrantAmountMinor        int64
	Currency                string
	WRRequiredMinor         int64
	MaxBetMinor             int64
	WithdrawPolicy          string
	AllowedGameIDs          []string
	PrizeWageringMultiplier int
}

// GrantChallengeBonusLocked mirrors GrantFromPromotionVersion for challenge-sourced WR bonuses.
func GrantChallengeBonusLocked(ctx context.Context, pool *pgxpool.Pool, a ChallengeGrantArgs) (inserted bool, err error) {
	if strings.TrimSpace(a.UserID) == "" || strings.TrimSpace(a.ChallengeEntryID) == "" {
		return false, fmt.Errorf("bonus: challenge grant requires user and entry")
	}
	if a.GrantAmountMinor <= 0 {
		return false, fmt.Errorf("bonus: challenge grant amount must be positive")
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return false, err
	}
	if !bf.BonusesEnabled {
		return false, ErrBonusesDisabled
	}

	withdrawPolicy := strings.TrimSpace(a.WithdrawPolicy)
	if withdrawPolicy == "" {
		withdrawPolicy = "block"
	}

	snap := map[string]any{
		"grant_minor":          a.GrantAmountMinor,
		"withdraw_policy":      withdrawPolicy,
		"challenge_title":      strings.TrimSpace(a.ChallengeTitle),
		"challenge_id":         strings.TrimSpace(a.ChallengeID),
		"challenge_entry_id":   strings.TrimSpace(a.ChallengeEntryID),
		"source":               "challenge_prize",
		"prize_wagering_mult":  a.PrizeWageringMultiplier,
		"wr_required_snapshot": a.WRRequiredMinor,
	}
	if len(a.AllowedGameIDs) > 0 {
		arr := make([]any, 0, len(a.AllowedGameIDs))
		for _, g := range a.AllowedGameIDs {
			g = strings.TrimSpace(g)
			if g != "" {
				arr = append(arr, g)
			}
		}
		if len(arr) > 0 {
			snap["allowed_game_ids"] = arr
		}
	}
	if a.MaxBetMinor > 0 {
		snap["max_bet_minor"] = a.MaxBetMinor
	}
	snapJSON, err := json.Marshal(snap)
	if err != nil {
		return false, err
	}

	wm := a.PrizeWageringMultiplier
	if wm <= 0 && a.GrantAmountMinor > 0 && a.WRRequiredMinor > 0 {
		wm = int(a.WRRequiredMinor / a.GrantAmountMinor)
	}
	rulesSnap := map[string]any{
		"wagering":        map[string]any{"multiplier": wm},
		"withdraw_policy": withdrawPolicy,
	}
	if len(a.AllowedGameIDs) > 0 {
		arr := make([]any, 0, len(a.AllowedGameIDs))
		for _, g := range a.AllowedGameIDs {
			g = strings.TrimSpace(g)
			if g != "" {
				arr = append(arr, g)
			}
		}
		if len(arr) > 0 {
			rulesSnap["allowed_game_ids"] = arr
		}
	}
	rulesSnapJSON, err := json.Marshal(rulesSnap)
	if err != nil {
		return false, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, a.UserID); err != nil {
		return false, err
	}

	pol := LoadAbusePolicy(ctx, pool)
	maxPrim := pol.MaxConcurrentActiveBonuses
	if maxPrim <= 0 {
		maxPrim = 1
	}
	n, err := countPrimarySlotBonuses(ctx, tx, a.UserID)
	if err != nil {
		return false, err
	}
	if int(n) >= maxPrim {
		return false, nil
	}

	var dup int
	err = tx.QueryRow(ctx, `SELECT 1 FROM user_bonus_instances WHERE idempotency_key = $1`, a.IdempotencyKey).Scan(&dup)
	if err == nil {
		return false, tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return false, err
	}

	var mb any
	if a.MaxBetMinor > 0 {
		mb = a.MaxBetMinor
	} else {
		mb = nil
	}

	var instID string
	err = tx.QueryRow(ctx, `
		INSERT INTO user_bonus_instances (
			user_id, promotion_version_id, challenge_entry_id, status, granted_amount_minor, currency,
			wr_required_minor, wr_contributed_minor, max_bet_minor, snapshot, rules_snapshot, terms_version, idempotency_key,
			exempt_from_primary_slot
		) VALUES (
			$1::uuid, NULL, $2::uuid, 'active', $3, $4, $5, 0, $6, $7::jsonb, $8::jsonb, '', $9, false
		) RETURNING id::text
	`, a.UserID, strings.TrimSpace(a.ChallengeEntryID), a.GrantAmountMinor, strings.TrimSpace(a.Currency),
		a.WRRequiredMinor, mb, snapJSON, rulesSnapJSON, a.IdempotencyKey).Scan(&instID)
	if err != nil {
		return false, err
	}

	meta := map[string]any{"bonus_instance_id": instID, "challenge_id": a.ChallengeID, "challenge_entry_id": a.ChallengeEntryID}
	if err := fingerprint.MergeTrafficAttributionTx(ctx, tx, a.UserID, time.Now().UTC(), meta); err != nil {
		return false, err
	}
	ins, err := ledger.ApplyCreditTxWithPocket(ctx, tx, a.UserID, a.Currency, "promo.grant",
		"promo.grant:"+a.IdempotencyKey, a.GrantAmountMinor, ledger.PocketBonusLocked, meta)
	if err != nil {
		return false, err
	}
	if !ins {
		return false, fmt.Errorf("bonus: duplicate promo.grant ledger line")
	}

	if err := insertBonusAuditLog(ctx, tx, "bonus_granted", bonusAuditActorSystem, "", a.UserID, instID, 0, a.GrantAmountMinor, a.Currency,
		map[string]any{"idempotency_key": a.IdempotencyKey, "source": "challenge_prize", "challenge_id": a.ChallengeID}); err != nil {
		return false, err
	}
	if err := insertBonusOutbox(ctx, tx, "BonusGranted", outboxPayloadGrant(a.UserID, 0, instID, a.Currency, a.IdempotencyKey, a.GrantAmountMinor)); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	obs.IncBonusGrant()
	return true, nil
}
