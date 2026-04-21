package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5"
)

var (
	ErrExcludedGame    = errors.New("bonus: game excluded by active promotion")
	ErrMaxBetExceeded  = errors.New("bonus: stake exceeds max bet for active bonus")
)

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
	if w, ok := obj["game_weight_pct"].(float64); ok && w > 0 {
		weightPct = int(w)
	}
	if w, ok := obj["game_weight_pct"].(int); ok && w > 0 {
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
		if x, ok := obj["max_bet_minor"].(float64); ok && x > 0 {
			maxBet = int64(x)
		}
	}
	return instanceID, maxBet, excluded, weightPct, withdrawPolicy, nil
}

// CheckBetAllowedTx enforces max bet and game exclusions using the open user transaction.
func CheckBetAllowedTx(ctx context.Context, tx pgx.Tx, userID, gameID string, stakeMinor int64) error {
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
		return ErrExcludedGame
	}
	if maxBet > 0 && stakeMinor > maxBet {
		obs.IncBonusBetReject()
		return ErrMaxBetExceeded
	}
	return nil
}

// ApplyPostBetWagering updates WR progress from stake taken from bonus_locked and may complete the bonus.
func ApplyPostBetWagering(ctx context.Context, tx pgx.Tx, userID, gameID string, fromBonus int64) error {
	if fromBonus <= 0 {
		return nil
	}
	var instID string
	var snap []byte
	var wrReq, wrDone int64
	err := tx.QueryRow(ctx, `
		SELECT id::text, snapshot, wr_required_minor, wr_contributed_minor
		FROM user_bonus_instances
		WHERE user_id = $1::uuid AND status = 'active' AND wr_required_minor > 0 AND wr_contributed_minor < wr_required_minor
		ORDER BY created_at ASC LIMIT 1 FOR UPDATE
	`, userID).Scan(&instID, &snap, &wrReq, &wrDone)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	var obj map[string]any
	_ = json.Unmarshal(snap, &obj)
	weightPct := 100
	if w, ok := obj["game_weight_pct"].(float64); ok && w > 0 {
		weightPct = int(w)
	}
	g := strings.ToLower(strings.TrimSpace(gameID))
	if arr, ok := obj["excluded_game_ids"].([]any); ok {
		for _, v := range arr {
			if s, ok := v.(string); ok && strings.ToLower(strings.TrimSpace(s)) == g {
				return nil
			}
		}
	}
	catW, err := contributionCategoryWeightPct(ctx, tx, gameID)
	if err != nil {
		return err
	}
	delta := (fromBonus * int64(weightPct) * int64(catW)) / 10000
	if delta < 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `
		UPDATE user_bonus_instances
		SET wr_contributed_minor = LEAST(wr_required_minor, wr_contributed_minor + $2), updated_at = now()
		WHERE id = $1::uuid
	`, instID, delta)
	if err != nil {
		return err
	}
	return maybeCompleteBonus(ctx, tx, userID, instID)
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
