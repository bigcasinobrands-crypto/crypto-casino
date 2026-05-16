package bonus

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBonusesDisabled is returned when global bonus kill switch is off.
var ErrBonusesDisabled = errors.New("bonuses are disabled")

// ErrBonusInstanceNotFound is returned when a bonus instance id does not exist.
var ErrBonusInstanceNotFound = errors.New("bonus: instance not found")

// ErrBonusInstanceForbidden is returned when a user does not own the instance.
var ErrBonusInstanceForbidden = errors.New("bonus: instance forbidden")

// GrantArgs is a server-side grant request (never trust client amounts).
type GrantArgs struct {
	UserID             string
	PromotionVersionID int64
	IdempotencyKey     string
	GrantAmountMinor   int64
	Currency           string
	DepositAmountMinor int64 // stored in snapshot for disputes
	// AllowPausedPromotion skips grants_paused when true (e.g. superadmin manual grant).
	AllowPausedPromotion bool
	// ExemptFromPrimarySlot when true (e.g. VIP tier grant_promotion) does not count toward
	// MaxConcurrentActiveBonuses; player may still hold one primary deposit/promo bonus alongside.
	ExemptFromPrimarySlot bool
	// ActorStaffID is optional; when set (manual admin grant), bonus_audit_log records actor_type admin.
	ActorStaffID string
	// WithdrawPolicyOverride, when non-empty, replaces rules.WithdrawPolicy in snapshot
	// (used by manual admin credit to force non-withdrawable behavior by default).
	WithdrawPolicyOverride string
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// CountActiveIncompleteWagering returns active bonus instances that still owe wagering.
// New promo grants (including daily calendar claims) are blocked while this is > 0.
func CountActiveIncompleteWagering(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	return countActiveIncompleteWagering(ctx, pool, userID)
}

func countActiveIncompleteWagering(ctx context.Context, q rowQuerier, userID string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances
		WHERE user_id = $1::uuid AND status = 'active' AND wr_required_minor > 0 AND wr_contributed_minor < wr_required_minor
	`, userID).Scan(&n)
	return n, err
}

func countPrimarySlotBonuses(ctx context.Context, q rowQuerier, userID string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances
		WHERE user_id = $1::uuid
		  AND COALESCE(exempt_from_primary_slot, false) = false
		  AND status IN ('active', 'pending', 'pending_review')
	`, userID).Scan(&n)
	return n, err
}

// GrantFromPromotionVersion creates a bonus instance and credits bonus_locked idempotently.
// wr_required_minor is derived from published rules and GrantAmountMinor (never from the client).
// The grant is always paired with a `promo.grant` ledger line keyed by IdempotencyKey so balances and audits stay ledger-backed.
func GrantFromPromotionVersion(ctx context.Context, pool *pgxpool.Pool, a GrantArgs) (inserted bool, err error) {
	if a.GrantAmountMinor <= 0 {
		return false, fmt.Errorf("bonus: grant amount must be positive")
	}
	bf, err := LoadFlags(ctx, pool)
	if err != nil {
		return false, err
	}
	if !bf.BonusesEnabled {
		return false, ErrBonusesDisabled
	}

	if !a.AllowPausedPromotion {
		rd := PreGrantRiskCheck(ctx, pool, a.UserID, a.PromotionVersionID, a.GrantAmountMinor)
		PersistRiskDecision(ctx, pool, a.UserID, a.PromotionVersionID, rd)
		if rd.Decision == "denied" {
			obs.IncBonusEvalError()
			return false, nil
		}
		if rd.Decision == "manual_review" {
			return false, nil
		}
	}

	var rulesJSON []byte
	var termsText, termsHash string
	err = pool.QueryRow(ctx, `
		SELECT pv.rules, COALESCE(pv.terms_text,''), COALESCE(pv.terms_hash,'')
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE pv.id = $1 AND p.status != 'archived' AND pv.published_at IS NOT NULL
		  AND ($2::bool OR COALESCE(p.grants_paused, false) = false)
	`, a.PromotionVersionID, a.AllowPausedPromotion).Scan(&rulesJSON, &termsText, &termsHash)
	if err != nil {
		return false, fmt.Errorf("bonus: promotion version not publishable")
	}
	rules, err := parseRules(rulesJSON)
	if err != nil {
		return false, err
	}
	wrReq := rules.wrRequired(a.GrantAmountMinor)
	maxBet := rules.Wagering.MaxBetMinor

	withdrawPolicy := strings.TrimSpace(rules.WithdrawPolicy)
	if ow := strings.TrimSpace(a.WithdrawPolicyOverride); ow != "" {
		withdrawPolicy = ow
	}

	snap := map[string]any{
		"rules":             json.RawMessage(rulesJSON),
		"deposit_minor":     a.DepositAmountMinor,
		"grant_minor":       a.GrantAmountMinor,
		"withdraw_policy":   withdrawPolicy,
		"excluded_game_ids": rules.ExcludedGameIDs,
		"allowed_game_ids":  rules.AllowedGameIDs,
		"game_weight_pct":   rules.Wagering.GameWeightPct,
		"max_bet_minor":     maxBet,
	}
	snapJSON, _ := json.Marshal(snap)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, a.UserID); err != nil {
		return false, err
	}

	if !a.ExemptFromPrimarySlot {
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
	}

	var dup int
	err = tx.QueryRow(ctx, `SELECT 1 FROM user_bonus_instances WHERE idempotency_key = $1`, a.IdempotencyKey).Scan(&dup)
	if err == nil {
		return false, tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return false, err
	}

	var instID string
	err = tx.QueryRow(ctx, `
		INSERT INTO user_bonus_instances (
			user_id, promotion_version_id, status, granted_amount_minor, currency,
			wr_required_minor, wr_contributed_minor, max_bet_minor, snapshot, rules_snapshot, terms_version, idempotency_key,
			exempt_from_primary_slot
		) VALUES (
			$1::uuid, $2, 'active', $3, $4, $5, 0, NULLIF($6,0), $7::jsonb, $8::jsonb, NULLIF($9,''), $10, $11
		) RETURNING id::text
	`, a.UserID, a.PromotionVersionID, a.GrantAmountMinor, a.Currency, wrReq, maxBet, snapJSON, rulesJSON, termsHash, a.IdempotencyKey, a.ExemptFromPrimarySlot).Scan(&instID)
	if err != nil {
		return false, err
	}

	meta := map[string]any{"promotion_version_id": a.PromotionVersionID, "bonus_instance_id": instID}
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

	grantActor := bonusAuditActorSystem
	grantActorID := ""
	if strings.TrimSpace(a.ActorStaffID) != "" {
		grantActor = bonusAuditActorAdmin
		grantActorID = strings.TrimSpace(a.ActorStaffID)
	}
	if err := insertBonusAuditLog(ctx, tx, "bonus_granted", grantActor, grantActorID, a.UserID, instID, a.PromotionVersionID, a.GrantAmountMinor, a.Currency,
		map[string]any{"idempotency_key": a.IdempotencyKey}); err != nil {
		return false, err
	}
	if err := insertBonusOutbox(ctx, tx, "BonusGranted", outboxPayloadGrant(a.UserID, a.PromotionVersionID, instID, a.Currency, a.IdempotencyKey, a.GrantAmountMinor)); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}

	obs.IncBonusGrant()
	return true, nil
}

// ForfeitInstance marks forfeited and removes remaining bonus_locked (best-effort single bonus pool).
// If recordPlayerRelinquishment is true, this promotion version is removed from the player’s future available-offer list (self-forfeit from the player app).
func ForfeitInstance(ctx context.Context, pool *pgxpool.Pool, instanceID, actorStaffID, reason string, recordPlayerRelinquishment bool) error {
	return retireInstance(ctx, pool, instanceID, actorStaffID, reason, recordPlayerRelinquishment, retireKindForfeit)
}

// ExpireInstance is the system-driven counterpart to ForfeitInstance and emits
// a distinct ledger entry type (`promo.expire`) so analytics can tell the
// difference between a player/admin voluntary forfeit and a TTL expiry.
// Promo expiry is always system-actuated, never recorded as a player
// relinquishment, and never carries a staff actor.
func ExpireInstance(ctx context.Context, pool *pgxpool.Pool, instanceID, reason string) error {
	r := strings.TrimSpace(reason)
	if r == "" {
		r = "expired"
	}
	return retireInstance(ctx, pool, instanceID, "", r, false, retireKindExpire)
}

type retireKind int

const (
	retireKindForfeit retireKind = iota
	retireKindExpire
)

func retireInstance(ctx context.Context, pool *pgxpool.Pool, instanceID, actorStaffID, reason string, recordPlayerRelinquishment bool, kind retireKind) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var uid, ccy string
	var status string
	var granted int64
	var pvid sql.NullInt64
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, currency, status, granted_amount_minor, promotion_version_id
		FROM user_bonus_instances WHERE id = $1::uuid FOR UPDATE
	`, instanceID).Scan(&uid, &ccy, &status, &granted, &pvid)
	if err != nil {
		return err
	}
	if status != "active" && status != "pending" {
		return fmt.Errorf("bonus: instance not forfeitable")
	}

	// Branch all kind-dependent strings up front so the rest of the flow stays
	// linear. The ledger entry type is the most consequential: it lets every
	// downstream report (bonus cost, NGR, KPI dashboards) tell a TTL expiry
	// apart from a deliberate forfeit.
	var (
		entryType  string
		idemPrefix string
		newStatus  string
		auditEvent string
		outboxKind string
	)
	switch kind {
	case retireKindExpire:
		entryType = ledger.EntryTypePromoExpire
		idemPrefix = "promo.expire:bonus"
		newStatus = "expired"
		auditEvent = "bonus_expired"
		outboxKind = "BonusExpired"
	default:
		entryType = ledger.EntryTypePromoForfeit
		idemPrefix = "promo.forfeit:bonus"
		newStatus = "forfeited"
		auditEvent = "bonus_forfeited"
		outboxKind = "BonusForfeited"
	}

	bonusBal, _ := ledger.BalanceBonusLockedTx(ctx, tx, uid)
	debit := bonusBal
	if debit <= 0 {
		debit = 0
	} else {
		idem := fmt.Sprintf("%s:%s", idemPrefix, instanceID)
		_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, uid, ccy, entryType, idem, debit, ledger.PocketBonusLocked,
			map[string]any{"bonus_instance_id": instanceID, "reason": reason})
		if err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE user_bonus_instances SET status = $2, updated_at = now() WHERE id = $1::uuid
	`, instanceID, newStatus); err != nil {
		return err
	}
	if actorStaffID != "" {
		meta, _ := json.Marshal(map[string]any{"bonus_instance_id": instanceID, "reason": reason})
		if _, err := tx.Exec(ctx, `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'bonushub.forfeit', 'user_bonus_instances', $2::jsonb)
		`, actorStaffID, meta); err != nil {
			slog.ErrorContext(ctx, "admin_audit_log_insert_failed", "action", "bonushub.forfeit", "err", err)
		}
	}

	ffActor, ffActorID := forfeitAuditActor(actorStaffID, reason)
	auditDelta := int64(0)
	if debit > 0 {
		auditDelta = -debit
	}
	pvAudit := int64(0)
	if pvid.Valid {
		pvAudit = pvid.Int64
	}
	if err := insertBonusAuditLog(ctx, tx, auditEvent, ffActor, ffActorID, uid, instanceID, pvAudit, auditDelta, ccy,
		map[string]any{"reason": reason, "debit_bonus_locked_minor": debit}); err != nil {
		return err
	}
	if err := insertBonusOutbox(ctx, tx, outboxKind, outboxPayloadForfeit(uid, instanceID, reason, ccy, granted)); err != nil {
		return err
	}

	if recordPlayerRelinquishment && pvid.Valid && pvid.Int64 > 0 {
		_, err = tx.Exec(ctx, `
			INSERT INTO player_promotion_relinquishments (user_id, promotion_version_id, source)
			VALUES ($1::uuid, $2, $3)
			ON CONFLICT (user_id, promotion_version_id) DO UPDATE SET
				source = EXCLUDED.source,
				created_at = now()
		`, uid, pvid.Int64, RelinquishForfeit)
		if err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

// PlayerForfeitInstance lets the authenticated player forfeit their own instance (active or pending).
// The promotion is recorded as relinquished so it does not re-list under available offers.
func PlayerForfeitInstance(ctx context.Context, pool *pgxpool.Pool, userID, instanceID, reason string) error {
	var owner string
	err := pool.QueryRow(ctx, `SELECT user_id::text FROM user_bonus_instances WHERE id = $1::uuid`, instanceID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrBonusInstanceNotFound
	}
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrBonusInstanceForbidden
	}
	return ForfeitInstance(ctx, pool, instanceID, "", reason, true)
}
