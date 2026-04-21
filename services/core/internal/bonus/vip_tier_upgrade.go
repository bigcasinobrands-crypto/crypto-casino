package bonus

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"

	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxVIPRebatePercentAdd caps summed passive rebate points added per user per program (base + add <= 100 after clamp).
const MaxVIPRebatePercentAdd = 30

// VIPTierBenefitRow is a row from vip_tier_benefits.
type VIPTierBenefitRow struct {
	ID                   int64
	TierID               int
	SortOrder            int
	Enabled              bool
	BenefitType          string
	PromotionVersionID   *int64
	Config               json.RawMessage
	PlayerTitle          *string
	PlayerDescription    *string
}

// TierSortOrder returns sort_order for a tier id; ok false if tier missing.
func TierSortOrder(ctx context.Context, pool *pgxpool.Pool, tierID *int) (sort int, ok bool) {
	if tierID == nil {
		return -1, false
	}
	err := pool.QueryRow(ctx, `SELECT sort_order FROM vip_tiers WHERE id = $1`, *tierID).Scan(&sort)
	if err != nil {
		return 0, false
	}
	return sort, true
}

// LoadTierBenefits returns enabled benefits for a tier ordered by sort_order.
func LoadTierBenefits(ctx context.Context, pool *pgxpool.Pool, tierID int) ([]VIPTierBenefitRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, tier_id, sort_order, enabled, benefit_type, promotion_version_id, config, player_title, player_description
		FROM vip_tier_benefits
		WHERE tier_id = $1 AND enabled = true
		ORDER BY sort_order ASC, id ASC
	`, tierID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VIPTierBenefitRow
	for rows.Next() {
		var r VIPTierBenefitRow
		if err := rows.Scan(&r.ID, &r.TierID, &r.SortOrder, &r.Enabled, &r.BenefitType, &r.PromotionVersionID, &r.Config, &r.PlayerTitle, &r.PlayerDescription); err != nil {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

type tierBenefitConfig struct {
	GrantAmountMinor     *int64 `json:"grant_amount_minor"`
	RebateProgramKey     string `json:"rebate_program_key"`
	PercentAdd           int    `json:"percent_add"`
	Repeat               string `json:"repeat"` // "once" (default) — reserved for future cooldown
}

func parseBenefitConfig(raw json.RawMessage) tierBenefitConfig {
	var c tierBenefitConfig
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &c)
	}
	return c
}

// GrantAmountForVIPTierBenefit resolves grant minor: config override, else promotion fixed reward.
func GrantAmountForVIPTierBenefit(ctx context.Context, pool *pgxpool.Pool, pvID int64, configJSON json.RawMessage) (int64, error) {
	cfg := parseBenefitConfig(configJSON)
	if cfg.GrantAmountMinor != nil && *cfg.GrantAmountMinor > 0 {
		return *cfg.GrantAmountMinor, nil
	}
	var rulesJSON []byte
	err := pool.QueryRow(ctx, `SELECT rules FROM promotion_versions WHERE id = $1`, pvID).Scan(&rulesJSON)
	if err != nil {
		return 0, err
	}
	rules, err := parseRules(rulesJSON)
	if err != nil {
		return 0, err
	}
	g := rules.computeGrantAmount(0)
	if g <= 0 && rules.Reward.FixedMinor > 0 {
		g = rules.Reward.FixedMinor
	}
	if g <= 0 {
		return 0, fmt.Errorf("vip tier benefit: promotion %d has no fixed grant (set config.grant_amount_minor or reward.fixed_minor)", pvID)
	}
	return g, nil
}

// VipRebatePercentAdd returns extra percent points for a user's current tier matching programKey.
func VipRebatePercentAdd(ctx context.Context, pool *pgxpool.Pool, userID, programKey string) (int, error) {
	if programKey == "" {
		return 0, nil
	}
	var sum *int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM((b.config->>'percent_add')::bigint), 0)::bigint
		FROM player_vip_state pvs
		JOIN vip_tier_benefits b ON b.tier_id = pvs.tier_id AND b.enabled = true
			AND b.benefit_type = 'rebate_percent_add'
			AND COALESCE(TRIM(b.config->>'rebate_program_key'), '') = $2
		WHERE pvs.user_id = $1::uuid AND pvs.tier_id IS NOT NULL
	`, userID, programKey).Scan(&sum)
	if err != nil || sum == nil {
		return 0, err
	}
	add := clampVipRebatePercentAdd(int(*sum))
	return add, nil
}

func clampVipRebatePercentAdd(n int) int {
	if n < 0 {
		return 0
	}
	if n > MaxVIPRebatePercentAdd {
		return MaxVIPRebatePercentAdd
	}
	return n
}

// ApplyVIPTierUpgrade runs after tier promotion (strictly higher sort_order). Logs events and grant_promotion benefits.
func ApplyVIPTierUpgrade(ctx context.Context, pool *pgxpool.Pool, userID string, fromTierID, toTierID *int, lifeWager int64) {
	if toTierID == nil {
		return
	}
	oldSO, oldOk := TierSortOrder(ctx, pool, fromTierID)
	newSO, newOk := TierSortOrder(ctx, pool, toTierID)
	if !newOk {
		return
	}
	if oldOk && newSO <= oldSO {
		return
	}
	obs.IncVipTierUp()
	initMeta, _ := json.Marshal(map[string]any{"benefits_attempted": 0, "benefits_granted": 0})
	var eventID int64
	err := pool.QueryRow(ctx, `
		INSERT INTO vip_tier_events (user_id, from_tier_id, to_tier_id, lifetime_wager_minor, meta)
		VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
		RETURNING id
	`, userID, fromTierID, toTierID, lifeWager, initMeta).Scan(&eventID)
	if err != nil {
		log.Printf("vip_tier_events insert: %v", err)
		obs.IncVipTierGrantError()
	}

	benefits, err := LoadTierBenefits(ctx, pool, *toTierID)
	if err != nil {
		log.Printf("LoadTierBenefits: %v", err)
		obs.IncVipTierGrantError()
		if eventID > 0 {
			_, _ = pool.Exec(ctx, `UPDATE vip_tier_events SET meta = meta || '{"load_error":true}'::jsonb WHERE id = $1`, eventID)
		}
		return
	}

	granted := 0
	attempted := 0
	for _, b := range benefits {
		if b.BenefitType != "grant_promotion" {
			continue
		}
		if b.PromotionVersionID == nil || *b.PromotionVersionID <= 0 {
			continue
		}
		attempted++
		pvID := *b.PromotionVersionID
		idem := fmt.Sprintf("vip:tier_up:tier:%d:benefit:%d:user:%s:pv:%d", *toTierID, b.ID, userID, pvID)

		var exists int
		_ = pool.QueryRow(ctx, `
			SELECT 1 FROM vip_tier_grant_log WHERE user_id = $1::uuid AND tier_id = $2 AND benefit_id = $3
		`, userID, *toTierID, b.ID).Scan(&exists)
		if exists == 1 {
			obs.IncVipTierGrantSkipped()
			continue
		}

		amt, err := GrantAmountForVIPTierBenefit(ctx, pool, pvID, b.Config)
		if err != nil || amt <= 0 {
			log.Printf("vip tier grant amount: %v", err)
			_, _ = pool.Exec(ctx, `
				INSERT INTO vip_tier_grant_log (user_id, tier_id, benefit_id, promotion_version_id, idempotency_key, result, detail)
				VALUES ($1::uuid, $2, $3, $4, $5, 'error', $6)
				ON CONFLICT (user_id, tier_id, benefit_id) DO NOTHING
			`, userID, *toTierID, b.ID, pvID, idem, truncateStr(errString(err), 500))
			obs.IncVipTierGrantError()
			continue
		}

		inserted, err := GrantFromPromotionVersion(ctx, pool, GrantArgs{
			UserID:             userID,
			PromotionVersionID: pvID,
			IdempotencyKey:     idem,
			GrantAmountMinor:   amt,
			Currency:           "USDT",
			DepositAmountMinor: 0,
		})
		if err != nil {
			log.Printf("GrantFromPromotionVersion vip tier: %v", err)
			_, _ = pool.Exec(ctx, `
				INSERT INTO vip_tier_grant_log (user_id, tier_id, benefit_id, promotion_version_id, idempotency_key, result, detail)
				VALUES ($1::uuid, $2, $3, $4, $5, 'error', $6)
				ON CONFLICT (user_id, tier_id, benefit_id) DO UPDATE SET result = EXCLUDED.result, detail = EXCLUDED.detail
			`, userID, *toTierID, b.ID, pvID, idem, truncateStr(err.Error(), 500))
			obs.IncVipTierGrantError()
			continue
		}
		if inserted {
			_, _ = pool.Exec(ctx, `
				INSERT INTO vip_tier_grant_log (user_id, tier_id, benefit_id, promotion_version_id, idempotency_key, result, detail)
				VALUES ($1::uuid, $2, $3, $4, $5, 'granted', '')
				ON CONFLICT (user_id, tier_id, benefit_id) DO UPDATE SET result = 'granted', promotion_version_id = EXCLUDED.promotion_version_id
			`, userID, *toTierID, b.ID, pvID, idem)
			granted++
			obs.IncVipTierGrantGranted()
		} else {
			var dup int
			_ = pool.QueryRow(ctx, `SELECT 1 FROM user_bonus_instances WHERE idempotency_key = $1`, idem).Scan(&dup)
			if dup == 1 {
				_, _ = pool.Exec(ctx, `
					INSERT INTO vip_tier_grant_log (user_id, tier_id, benefit_id, promotion_version_id, idempotency_key, result, detail)
					VALUES ($1::uuid, $2, $3, $4, $5, 'granted', 'idempotent_duplicate')
					ON CONFLICT (user_id, tier_id, benefit_id) DO UPDATE SET result = 'granted', detail = 'idempotent_duplicate'
				`, userID, *toTierID, b.ID, pvID, idem)
				granted++
				obs.IncVipTierGrantGranted()
			} else {
				detail := "not_inserted_active_wr_risk_or_denied"
				_, _ = pool.Exec(ctx, `
					INSERT INTO vip_tier_grant_log (user_id, tier_id, benefit_id, promotion_version_id, idempotency_key, result, detail)
					VALUES ($1::uuid, $2, $3, $4, $5, 'skipped', $6)
					ON CONFLICT (user_id, tier_id, benefit_id) DO UPDATE SET result = EXCLUDED.result, detail = EXCLUDED.detail
				`, userID, *toTierID, b.ID, pvID, idem, detail)
				obs.IncVipTierGrantSkipped()
			}
		}
	}

	if eventID > 0 {
		sumMeta, _ := json.Marshal(map[string]any{"benefits_attempted": attempted, "benefits_granted": granted})
		_, _ = pool.Exec(ctx, `UPDATE vip_tier_events SET meta = meta || $2::jsonb WHERE id = $1`, eventID, sumMeta)
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// VipTierBenefitsForProgram returns public benefit blurbs for /v1/vip/program.
func VipTierBenefitsForProgram(ctx context.Context, pool *pgxpool.Pool, tierID int) ([]map[string]any, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, benefit_type, promotion_version_id, config, player_title, player_description, sort_order
		FROM vip_tier_benefits
		WHERE tier_id = $1 AND enabled = true
		ORDER BY sort_order ASC, id ASC
	`, tierID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var sort int
		var btype string
		var pv *int64
		var cfg []byte
		var title, desc *string
		if err := rows.Scan(&id, &btype, &pv, &cfg, &title, &desc, &sort); err != nil {
			continue
		}
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		m := map[string]any{
			"id": id, "benefit_type": btype, "sort_order": sort, "config": cm,
		}
		if pv != nil {
			m["promotion_version_id"] = *pv
		}
		if title != nil {
			m["player_title"] = *title
		}
		if desc != nil {
			m["player_description"] = *desc
		}
		out = append(out, m)
	}
	return out, nil
}

// VipRebateAddsForUser returns map program_key -> percent_add for status/hub.
func VipRebateAddsForUser(ctx context.Context, pool *pgxpool.Pool, userID string) (map[string]int, error) {
	rows, err := pool.Query(ctx, `
		SELECT COALESCE(TRIM(b.config->>'rebate_program_key'), ''), COALESCE((b.config->>'percent_add')::int, 0)
		FROM player_vip_state pvs
		JOIN vip_tier_benefits b ON b.tier_id = pvs.tier_id AND b.enabled = true AND b.benefit_type = 'rebate_percent_add'
		WHERE pvs.user_id = $1::uuid AND pvs.tier_id IS NOT NULL
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]int)
	for rows.Next() {
		var key string
		var add int
		if err := rows.Scan(&key, &add); err != nil {
			continue
		}
		if key == "" || add <= 0 {
			continue
		}
		out[key] = clampVipRebatePercentAdd(out[key] + add)
	}
	return out, nil
}

// FormatBenefitSummary for meta / logging.
func FormatBenefitSummary(benefits []VIPTierBenefitRow) string {
	return strconv.Itoa(len(benefits))
}
