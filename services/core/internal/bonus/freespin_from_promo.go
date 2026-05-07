package bonus

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FreeSpinEnqueueArgs queues a free_spin_grants row for the Blue Ocean worker.
type FreeSpinEnqueueArgs struct {
	UserID               string
	PromotionVersionID   int64
	IdempotencyKey       string
	Rounds               int
	GameID               string
	BetPerRoundMinor     int64
	Title                string
	Source               string
	AllowPausedPromotion bool
	ActorStaffID         string
}

// EnqueueFreeSpinFromPromotionVersion creates a pending free_spin_grants row (idempotent) after risk checks.
// inserted is true only for a new row. Does not credit cash or create user_bonus_instances.
func EnqueueFreeSpinFromPromotionVersion(ctx context.Context, pool *pgxpool.Pool, a FreeSpinEnqueueArgs) (inserted bool, err error) {
	if a.Rounds <= 0 || strings.TrimSpace(a.GameID) == "" {
		return false, fmt.Errorf("bonus: free spin rounds and game_id required")
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return false, err
	}
	if !bf.BonusesEnabled {
		return false, ErrBonusesDisabled
	}

	if !a.AllowPausedPromotion {
		notional := notionalForFreeSpinRisk(a.Rounds, a.BetPerRoundMinor)
		rd := PreGrantRiskCheck(ctx, pool, a.UserID, a.PromotionVersionID, notional)
		PersistRiskDecision(ctx, pool, a.UserID, a.PromotionVersionID, rd)
		if rd.Decision == "denied" {
			return false, nil
		}
		if rd.Decision == "manual_review" {
			return false, nil
		}
	}

	var rulesJSON []byte
	var ptitle string
	err = pool.QueryRow(ctx, `
		SELECT pv.rules, COALESCE(NULLIF(TRIM(p.player_title), ''), NULLIF(TRIM(pv.player_title), ''), '')
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE pv.id = $1 AND p.status != 'archived' AND pv.published_at IS NOT NULL
		  AND ($2::bool OR COALESCE(p.grants_paused, false) = false)
	`, a.PromotionVersionID, a.AllowPausedPromotion).Scan(&rulesJSON, &ptitle)
	if err != nil {
		return false, fmt.Errorf("bonus: promotion version not available for free spins")
	}

	title := strings.TrimSpace(a.Title)
	if title == "" {
		title = strings.TrimSpace(ptitle)
	}
	if title == "" {
		title = "Free rounds"
	}

	pvid := a.PromotionVersionID
	meta := map[string]any{
		"title":  title,
		"source": strings.TrimSpace(a.Source),
	}
	if strings.TrimSpace(a.ActorStaffID) != "" {
		meta["actor_staff_id"] = strings.TrimSpace(a.ActorStaffID)
	}
	bet := a.BetPerRoundMinor
	if bet <= 0 {
		bet = 1
	}
	grantID, ins, err := InsertFreeSpinGrantWithMetadata(ctx, pool, a.UserID, &pvid, a.IdempotencyKey, a.GameID, a.Rounds, bet, meta)
	if err != nil {
		return false, err
	}
	if !ins {
		return false, nil
	}
	// Bonus-5: surface the free-spin liability in the ledger timeline. Free
	// spins are not a cash movement, but they are a real promo cost — without
	// this row, ledger-based reconciliation cannot see the grant. Use a
	// non-balance (zero amount) event so balances are not affected.
	ledgerMeta := map[string]any{
		"free_spin_grant_id":   grantID,
		"promotion_version_id": a.PromotionVersionID,
		"rounds":               a.Rounds,
		"game_id":              a.GameID,
		"bet_per_round_minor":  bet,
		"source":               strings.TrimSpace(a.Source),
	}
	if strings.TrimSpace(a.ActorStaffID) != "" {
		ledgerMeta["actor_staff_id"] = strings.TrimSpace(a.ActorStaffID)
	}
	if _, lerr := ledger.RecordNonBalanceEvent(ctx, pool,
		a.UserID, "USDT", ledger.EntryTypePromoFreeSpinGrant,
		"promo.free_spin_grant:"+a.IdempotencyKey, ledgerMeta); lerr != nil {
		slog.ErrorContext(ctx, "free_spin_ledger_event_failed",
			"user_id", a.UserID, "free_spin_grant_id", grantID, "err", lerr)
	}
	actor := bonusAuditActorSystem
	actID := ""
	if strings.TrimSpace(a.ActorStaffID) != "" {
		actor = bonusAuditActorAdmin
		actID = strings.TrimSpace(a.ActorStaffID)
	}
	_ = insertBonusAuditLog(ctx, pool, "free_spin_queued", actor, actID, a.UserID, "", a.PromotionVersionID, 0, "USDT",
		map[string]any{
			"idempotency_key": a.IdempotencyKey, "rounds": a.Rounds, "game_id": a.GameID, "source": a.Source,
		})
	return true, nil
}
