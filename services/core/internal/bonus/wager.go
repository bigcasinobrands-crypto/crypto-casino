package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5"
)

var (
	ErrExcludedGame   = errors.New("bonus: game excluded by active promotion")
	ErrMaxBetExceeded = errors.New("bonus: stake exceeds max bet for active bonus")
)

func snapPositiveInt64FromMap(obj map[string]any, key string) int64 {
	if obj == nil {
		return 0
	}
	v, ok := obj[key]
	if !ok || v == nil {
		return 0
	}
	switch x := v.(type) {
	case float64:
		if x > 0 && x < 1e18 {
			return int64(x)
		}
	case int64:
		if x > 0 {
			return x
		}
	case int:
		if x > 0 {
			return int64(x)
		}
	case int32:
		if x > 0 {
			return int64(x)
		}
	case json.Number:
		i, err := x.Int64()
		if err == nil && i > 0 {
			return i
		}
	case string:
		i, err := strconv.ParseInt(strings.TrimSpace(x), 10, 64)
		if err == nil && i > 0 {
			return i
		}
	}
	return 0
}

// snapPositiveWeightPct reads snapshot game_weight_pct (1–1000); 0 if unset/invalid.
func snapPositiveWeightPct(obj map[string]any, key string) int {
	n := int(snapPositiveInt64FromMap(obj, key))
	if n <= 0 {
		return 0
	}
	if n > 1000 {
		return 1000
	}
	return n
}

// ActiveWageringInstance returns the active bonus instance row for wagering enforcement.
func ActiveWageringInstance(ctx context.Context, tx pgx.Tx, userID string) (instanceID string, maxBet int64, excluded map[string]bool, weightPct int, withdrawPolicy string, err error) {
	var snap []byte
	var mb *int64
	err = tx.QueryRow(ctx, `
		SELECT id::text, max_bet_minor, snapshot
		FROM user_bonus_instances
		WHERE user_id = $1::uuid AND status = 'active' AND wr_required_minor > 0 AND wr_contributed_minor < wr_required_minor
		ORDER BY created_at ASC LIMIT 1
	`, userID).Scan(&instanceID, &mb, &snap)
	if err == pgx.ErrNoRows {
		return "", 0, nil, 100, "", nil
	}
	if err != nil {
		return "", 0, nil, 100, "", err
	}
	excluded = map[string]bool{}
	var obj map[string]any
	_ = json.Unmarshal(snap, &obj)
	if arr, ok := obj["excluded_game_ids"].([]any); ok {
		for _, v := range arr {
			if s, ok := v.(string); ok {
				excluded[strings.ToLower(strings.TrimSpace(s))] = true
			}
		}
	}
	weightPct = 100
	if w := snapPositiveWeightPct(obj, "game_weight_pct"); w > 0 {
		weightPct = w
	}
	if pol, ok := obj["withdraw_policy"].(string); ok {
		withdrawPolicy = pol
	}
	maxBet = 0
	if mb != nil {
		maxBet = *mb
	}
	if maxBet == 0 {
		if x := snapPositiveInt64FromMap(obj, "max_bet_minor"); x > 0 {
			maxBet = x
		}
	}
	return instanceID, maxBet, excluded, weightPct, withdrawPolicy, nil
}

// CheckBetAllowedTx enforces max bet and game exclusions using the open user transaction.
// sourceRef is optional (e.g. BlueOcean remote:txn) for correlating duplicate provider retries in bonus_wager_violations.
func CheckBetAllowedTx(ctx context.Context, tx pgx.Tx, userID, gameID string, stakeMinor int64, sourceRef string) error {
	instID, maxBet, excluded, _, _, err := ActiveWageringInstance(ctx, tx, userID)
	if err != nil {
		return err
	}
	if instID == "" {
		return nil
	}
	g := strings.ToLower(strings.TrimSpace(gameID))
	if excluded[g] {
		obs.IncBonusBetReject()
		_ = recordWagerViolationTx(ctx, tx, userID, instID, gameID, stakeMinor, 0, "excluded_game", sourceRef)
		return ErrExcludedGame
	}
	if maxBet > 0 && stakeMinor > maxBet {
		obs.IncBonusBetReject()
		_ = recordWagerViolationTx(ctx, tx, userID, instID, gameID, stakeMinor, maxBet, "max_bet", sourceRef)
		return ErrMaxBetExceeded
	}
	return nil
}

func recordWagerViolationTx(ctx context.Context, tx pgx.Tx, userID, instanceID, gameID string, stakeMinor, maxBetMinor int64, violationType, sourceRef string) error {
	gid := strings.TrimSpace(gameID)
	if len(gid) > 512 {
		gid = gid[:512]
	}
	var ref any
	sr := strings.TrimSpace(sourceRef)
	if sr != "" {
		if len(sr) > 500 {
			sr = sr[:500]
		}
		ref = sr
	} else {
		ref = nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO bonus_wager_violations (user_id, bonus_instance_id, game_id, stake_minor, max_bet_minor, violation_type, source_ref)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
	`, userID, instanceID, gid, stakeMinor, maxBetMinor, violationType, ref)
	if err != nil {
		return err
	}
	if violationType == "max_bet" {
		_, err = tx.Exec(ctx, `
			UPDATE user_bonus_instances SET max_bet_violations_count = max_bet_violations_count + 1, updated_at = now() WHERE id = $1::uuid
		`, instanceID)
	}
	return err
}

// ApplyPostBetWagering updates WR progress from the full debit stake (cash + bonus_locked portions)
// while the player has an active unfinished WR instance. Game/category weights and exclusions apply.
// Returns whether wr_contributed_minor was increased (for optional real-time fan-out).
func ApplyPostBetWagering(ctx context.Context, tx pgx.Tx, userID, gameID string, stakeMinor int64) (progressUpdated bool, err error) {
	if stakeMinor <= 0 {
		return false, nil
	}
	var instID string
	var snap []byte
	var wrReq, wrDone int64
	err = tx.QueryRow(ctx, `
		SELECT id::text, snapshot, wr_required_minor, wr_contributed_minor
		FROM user_bonus_instances
		WHERE user_id = $1::uuid AND status = 'active' AND wr_required_minor > 0 AND wr_contributed_minor < wr_required_minor
		ORDER BY created_at ASC LIMIT 1 FOR UPDATE
	`, userID).Scan(&instID, &snap, &wrReq, &wrDone)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var obj map[string]any
	_ = json.Unmarshal(snap, &obj)
	weightPct := 100
	if w := snapPositiveWeightPct(obj, "game_weight_pct"); w > 0 {
		weightPct = w
	}
	g := strings.ToLower(strings.TrimSpace(gameID))
	if arr, ok := obj["excluded_game_ids"].([]any); ok {
		for _, v := range arr {
			if s, ok := v.(string); ok && strings.ToLower(strings.TrimSpace(s)) == g {
				return false, nil
			}
		}
	}
	if arr, ok := obj["allowed_game_ids"].([]any); ok && len(arr) > 0 {
		allowed := false
		for _, v := range arr {
			if s, ok := v.(string); ok && strings.ToLower(strings.TrimSpace(s)) == g {
				allowed = true
				break
			}
		}
		if !allowed {
			return false, nil
		}
	}
	catW, err := contributionCategoryWeightPct(ctx, tx, gameID)
	if err != nil {
		return false, err
	}
	delta := (stakeMinor * int64(weightPct) * int64(catW)) / 10000
	if delta <= 0 {
		return false, nil
	}
	_, err = tx.Exec(ctx, `
		UPDATE user_bonus_instances
		SET wr_contributed_minor = LEAST(wr_required_minor, wr_contributed_minor + $2), updated_at = now()
		WHERE id = $1::uuid
	`, instID, delta)
	if err != nil {
		return false, err
	}
	if err = maybeCompleteBonus(ctx, tx, userID, instID); err != nil {
		return false, err
	}
	return true, nil
}

// ApplyPostBetRollbackWagering reduces WR contribution when stake (cash + bonus_locked) is rolled back.
// Call only when the corresponding game.rollback ledger lines were newly inserted (idempotent via ledger ON CONFLICT).
// stakeRollbackMinor should be the sum of newly-inserted rollback magnitudes for this txn.
func ApplyPostBetRollbackWagering(ctx context.Context, tx pgx.Tx, userID, gameID string, stakeRollbackMinor int64) (progressUpdated bool, err error) {
	if stakeRollbackMinor <= 0 {
		return false, nil
	}
	var instID string
	var snap []byte
	var wrReq, wrDone int64
	var status string
	err = tx.QueryRow(ctx, `
		SELECT id::text, snapshot, wr_required_minor, wr_contributed_minor, status
		FROM user_bonus_instances
		WHERE user_id = $1::uuid AND wr_required_minor > 0
		ORDER BY created_at ASC LIMIT 1 FOR UPDATE
	`, userID).Scan(&instID, &snap, &wrReq, &wrDone, &status)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !strings.EqualFold(strings.TrimSpace(status), "active") {
		return false, nil
	}
	if wrDone <= 0 {
		return false, nil
	}
	var obj map[string]any
	_ = json.Unmarshal(snap, &obj)
	weightPct := 100
	if w := snapPositiveWeightPct(obj, "game_weight_pct"); w > 0 {
		weightPct = w
	}
	g := strings.ToLower(strings.TrimSpace(gameID))
	if arr, ok := obj["excluded_game_ids"].([]any); ok {
		for _, v := range arr {
			if s, ok := v.(string); ok && strings.ToLower(strings.TrimSpace(s)) == g {
				return false, nil
			}
		}
	}
	if arr, ok := obj["allowed_game_ids"].([]any); ok && len(arr) > 0 {
		allowed := false
		for _, v := range arr {
			if s, ok := v.(string); ok && strings.ToLower(strings.TrimSpace(s)) == g {
				allowed = true
				break
			}
		}
		if !allowed {
			return false, nil
		}
	}
	catW, err := contributionCategoryWeightPct(ctx, tx, gameID)
	if err != nil {
		return false, err
	}
	delta := (stakeRollbackMinor * int64(weightPct) * int64(catW)) / 10000
	if delta <= 0 {
		return false, nil
	}
	_, err = tx.Exec(ctx, `
		UPDATE user_bonus_instances
		SET wr_contributed_minor = GREATEST(0, wr_contributed_minor - $2), updated_at = now()
		WHERE id = $1::uuid
	`, instID, delta)
	if err != nil {
		return false, err
	}
	return true, nil
}

func maybeCompleteBonus(ctx context.Context, tx pgx.Tx, userID, instID string) error {
	var wrReq, wrDone int64
	var ccy string
	err := tx.QueryRow(ctx, `
		SELECT wr_required_minor, wr_contributed_minor, currency
		FROM user_bonus_instances WHERE id = $1::uuid FOR UPDATE
	`, instID).Scan(&wrReq, &wrDone, &ccy)
	if err != nil || wrReq <= 0 || wrDone < wrReq {
		return nil
	}

	bonusBal, err := ledger.BalanceBonusLockedTx(ctx, tx, userID)
	if err != nil {
		return err
	}
	if bonusBal <= 0 {
		_, err = tx.Exec(ctx, `UPDATE user_bonus_instances SET status = 'completed', updated_at = now() WHERE id = $1::uuid`, instID)
		return err
	}

	cashIDem := fmt.Sprintf("promo.convert:cash:%s", instID)
	bonusIDem := fmt.Sprintf("promo.convert:bonus:%s", instID)
	_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "promo.convert", bonusIDem, bonusBal, ledger.PocketBonusLocked,
		map[string]any{"bonus_instance_id": instID})
	if err != nil {
		return err
	}
	_, err = ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "promo.convert", cashIDem, bonusBal, ledger.PocketCash,
		map[string]any{"bonus_instance_id": instID})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE user_bonus_instances SET status = 'completed', updated_at = now() WHERE id = $1::uuid`, instID)
	return err
}
