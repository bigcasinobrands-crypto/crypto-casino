package bonus

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxVIPRebatePercentAdd caps summed passive rebate points added per user per program (base + add <= 100 after clamp).
const MaxVIPRebatePercentAdd = 30.0

// VIPTierBenefitRow is a row from vip_tier_benefits.
type VIPTierBenefitRow struct {
	ID                 int64
	TierID             int
	SortOrder          int
	Enabled            bool
	BenefitType        string
	PromotionVersionID *int64
	Config             json.RawMessage
	PlayerTitle        *string
	PlayerDescription  *string
}

// TierSortOrder returns tier progression rank by min_lifetime_wager_minor (ASC).
// Kept as compatibility shim for existing callsites.
func TierSortOrder(ctx context.Context, pool *pgxpool.Pool, tierID *int) (sort int, ok bool) {
	if tierID == nil {
		return -1, false
	}
	err := pool.QueryRow(ctx, `
		SELECT rnk FROM (
			SELECT id, ROW_NUMBER() OVER (ORDER BY min_lifetime_wager_minor ASC, id ASC)::int AS rnk
			FROM vip_tiers
		) t WHERE t.id = $1
	`, *tierID).Scan(&sort)
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
	GrantAmountMinor *int64 `json:"grant_amount_minor"`
	RebateProgramKey string `json:"rebate_program_key"`
	PercentAdd       float64 `json:"percent_add"`
	Repeat           string `json:"repeat"` // "once" (default) — reserved for future cooldown
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
func VipRebatePercentAdd(ctx context.Context, pool *pgxpool.Pool, userID, programKey string) (float64, error) {
	if programKey == "" {
		return 0, nil
	}
	var sum *float64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM((b.config->>'percent_add')::numeric), 0)::float8
		FROM player_vip_state pvs
		JOIN vip_tier_benefits b ON b.tier_id = pvs.tier_id AND b.enabled = true
			AND b.benefit_type = 'rebate_percent_add'
			AND COALESCE(TRIM(b.config->>'rebate_program_key'), '') = $2
		WHERE pvs.user_id = $1::uuid AND pvs.tier_id IS NOT NULL
	`, userID, programKey).Scan(&sum)
	if err != nil || sum == nil {
		return 0, err
	}
	add := clampVipRebatePercentAdd(*sum)
	return add, nil
}

func roundPercent(n float64) float64 {
	return math.Round(n*100) / 100
}

func clampVipRebatePercentAdd(n float64) float64 {
	if n < 0 {
		return 0
	}
	if n > MaxVIPRebatePercentAdd {
		return MaxVIPRebatePercentAdd
	}
	return roundPercent(n)
}

// ApplyVIPTierUpgrade runs after tier promotion (strictly higher sort_order). Logs events and grant_promotion benefits.
func ApplyVIPTierUpgrade(ctx context.Context, pool *pgxpool.Pool, userID string, fromTierID, toTierID *int, lifeWager int64) {
	upgradeAt := time.Now().UTC()
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
	insertErr := pool.QueryRow(ctx, `
		INSERT INTO vip_tier_events (user_id, from_tier_id, to_tier_id, lifetime_wager_minor, meta)
		VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
		RETURNING id
	`, userID, fromTierID, toTierID, lifeWager, initMeta).Scan(&eventID)
	if insertErr != nil {
		log.Printf("vip_tier_events insert: %v", insertErr)
		obs.IncVipTierGrantError()
	}
	if insertErr == nil && toTierID != nil {
		var toName string
		if qErr := pool.QueryRow(ctx, `SELECT COALESCE(NULLIF(TRIM(name), ''), 'VIP tier') FROM vip_tiers WHERE id = $1`, *toTierID).Scan(&toName); qErr == nil {
			_ = insertNotification(ctx, pool, userID, "vip.tier_up", "VIP rank up!",
				fmt.Sprintf("You've reached %s.", toName),
				map[string]any{"to_tier_id": *toTierID, "event_id": eventID})
		}
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
		if b.BenefitType != "grant_promotion" && b.BenefitType != "level_up_cash_percent" {
			continue
		}
		attempted++
		pvID := int64(0)
		if b.PromotionVersionID != nil {
			pvID = *b.PromotionVersionID
		}
		idem := fmt.Sprintf("vip:tier_up:tier:%d:benefit:%d:user:%s:type:%s", *toTierID, b.ID, userID, b.BenefitType)

		var exists int
		_ = pool.QueryRow(ctx, `
			SELECT 1 FROM vip_tier_grant_log WHERE user_id = $1::uuid AND tier_id = $2 AND benefit_id = $3
		`, userID, *toTierID, b.ID).Scan(&exists)
		if exists == 1 {
			obs.IncVipTierGrantSkipped()
			continue
		}

		var amt int64
		var err error
		if b.BenefitType == "grant_promotion" {
			if pvID <= 0 {
				continue
			}
			amt, err = GrantAmountForVIPTierBenefit(ctx, pool, pvID, b.Config)
		} else {
			amt, err = levelUpCashPercentAmount(ctx, pool, userID, fromTierID, lifeWager, b.Config, upgradeAt)
		}
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

		var inserted bool
		if b.BenefitType == "grant_promotion" {
			inserted, err = GrantFromPromotionVersion(ctx, pool, GrantArgs{
				UserID:                userID,
				PromotionVersionID:    pvID,
				IdempotencyKey:        idem,
				GrantAmountMinor:      amt,
				Currency:              "USDT",
				DepositAmountMinor:    0,
				ExemptFromPrimarySlot: true,
			})
		} else {
			inserted, err = PayoutAndCreditCash(ctx, pool, userID, "USDT", "vip.level_up_cash", idem, amt, map[string]any{
				"tier_id": *toTierID, "benefit_id": b.ID, "amount_minor": amt,
			})
		}
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
				detail := "not_inserted_primary_slot_risk_or_denied"
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

	// Message-center notification for tier-up and auto-applied VIP benefits.
	var toTierName string
	if err := pool.QueryRow(ctx, `SELECT name FROM vip_tiers WHERE id = $1`, *toTierID).Scan(&toTierName); err == nil {
		title := "VIP tier upgraded"
		body := "You reached " + toTierName + "."
		if granted > 0 {
			body += " " + strconv.Itoa(granted) + " tier benefit(s) were automatically applied."
		} else if attempted > 0 {
			body += " Your tier benefits are being processed."
		}
		_ = insertNotification(ctx, pool, userID, "vip_tier_upgraded", title, body, map[string]any{
			"to_tier_id":         *toTierID,
			"to_tier_name":       toTierName,
			"benefits_attempted": attempted,
			"benefits_granted":   granted,
		})
	}
}

// levelUpCashBaseFromLedger is net successful stake (cash + bonus_locked; casino + sportsbook; net of rollbacks)
// from the last time the user reached fromTierID until upgradeAt. That matches "wagering while on the previous level"
// rather than lifetime_wager_minor minus the previous tier threshold (which can diverge after tier rebalances).
// If no vip_tier_events row exists for that tier (migrated users), falls back to the lifetime band lifeWager-prevMin.
// When fromTierID is nil (first tier), the base remains lifetime_wager_minor (no prior tier in the product sense).
func levelUpCashBaseFromLedger(ctx context.Context, pool *pgxpool.Pool, userID string, fromTierID *int, lifeWager, prevMin int64, upgradeAt time.Time) int64 {
	if fromTierID == nil || *fromTierID <= 0 {
		if lifeWager < 0 {
			return 0
		}
		return lifeWager
	}
	fallbackBand := func() int64 {
		b := lifeWager - prevMin
		if b < 0 {
			b = lifeWager
		}
		if b < 0 {
			return 0
		}
		return b
	}
	var tierEnteredAt time.Time
	err := pool.QueryRow(ctx, `
		SELECT created_at
		FROM vip_tier_events
		WHERE user_id = $1::uuid AND to_tier_id = $2
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, userID, *fromTierID).Scan(&tierEnteredAt)
	if err != nil {
		return fallbackBand()
	}
	start := tierEnteredAt.UTC()
	end := upgradeAt.UTC()
	w, sErr := ledger.SumSuccessfulPlayableStakeForWindow(ctx, pool, userID, start, end)
	if sErr != nil {
		return fallbackBand()
	}
	return w
}

func levelUpCashPercentAmount(ctx context.Context, pool *pgxpool.Pool, userID string, fromTierID *int, lifeWager int64, cfgRaw json.RawMessage, upgradeAt time.Time) (int64, error) {
	var cfg map[string]any
	_ = json.Unmarshal(cfgRaw, &cfg)
	pctF, _ := cfg["percent_of_previous_level_wager"].(float64)
	if pctF <= 0 {
		return 0, fmt.Errorf("percent_of_previous_level_wager must be > 0")
	}
	prevMin := int64(0)
	if fromTierID != nil && *fromTierID > 0 {
		_ = pool.QueryRow(ctx, `SELECT min_lifetime_wager_minor FROM vip_tiers WHERE id = $1`, *fromTierID).Scan(&prevMin)
	}
	base := levelUpCashBaseFromLedger(ctx, pool, userID, fromTierID, lifeWager, prevMin, upgradeAt)
	if base <= 0 {
		return 0, nil
	}
	amt := int64(math.Round((float64(base) * pctF) / 100.0))
	if maxF, ok := cfg["max_grant_minor"].(float64); ok {
		max := int64(maxF)
		if max > 0 && amt > max {
			amt = max
		}
	}
	return amt, nil
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
		SELECT b.id, b.benefit_type, b.promotion_version_id, b.config, b.player_title, b.player_description, b.sort_order
		FROM vip_tier_benefits b
		WHERE b.tier_id = $1 AND b.enabled = true
		ORDER BY b.sort_order ASC, b.id ASC
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
		if pv != nil && *pv > 0 {
			var pTitle, pDesc string
			if qErr := pool.QueryRow(ctx, `
				SELECT
					COALESCE(NULLIF(TRIM(pv.player_title), ''), NULLIF(TRIM(p.name), '')),
					COALESCE(NULLIF(TRIM(pv.player_description), ''), '')
				FROM promotion_versions pv
				LEFT JOIN promotions p ON p.id = pv.promotion_id
				WHERE pv.id = $1
			`, *pv).Scan(&pTitle, &pDesc); qErr == nil {
				if strings.TrimSpace(pTitle) != "" {
					m["promotion_display_title"] = strings.TrimSpace(pTitle)
				}
				if strings.TrimSpace(pDesc) != "" {
					m["promotion_display_description"] = strings.TrimSpace(pDesc)
				}
			}
		}
		out = append(out, m)
	}
	// Daily Hunt is configured via reward_programs, not vip_tier_benefits rows.
	// Expose it as a synthetic card so player tier dropdown reflects admin ON/OFF.
	var huntCfgRaw []byte
	err = pool.QueryRow(ctx, `
		SELECT config
		FROM reward_programs
		WHERE kind = $1 AND enabled = true
		ORDER BY id ASC
		LIMIT 1
	`, RewardKindDailyHunt).Scan(&huntCfgRaw)
	if err == nil && len(huntCfgRaw) > 0 {
		if hc, pErr := parseHuntConfig(huntCfgRaw); pErr == nil {
			enabled := true
			if o, ok := hc.Tiers[strconv.Itoa(tierID)]; ok && o.Enabled != nil {
				enabled = *o.Enabled
			}
			if enabled {
				title := "Daily Dollar Hunts"
				description := "Earn XP & get cash rewards"
				if o, ok := hc.Tiers[strconv.Itoa(tierID)]; ok {
					if strings.TrimSpace(o.CardTitle) != "" {
						title = strings.TrimSpace(o.CardTitle)
					}
					if strings.TrimSpace(o.CardDescription) != "" {
						description = strings.TrimSpace(o.CardDescription)
					}
				}
				out = append(out, map[string]any{
					"id":                 int64(-1000000 - tierID),
					"benefit_type":       "vip_card_feature",
					"sort_order":         9000,
					"config":             map[string]any{"icon_key": "zap", "title": title, "subtitle": description},
					"player_title":       title,
					"player_description": description,
				})
			}
		}
	}
	return out, nil
}

// VipRebateAddsForUser returns map program_key -> percent_add for status/hub.
func VipRebateAddsForUser(ctx context.Context, pool *pgxpool.Pool, userID string) (map[string]float64, error) {
	rows, err := pool.Query(ctx, `
		SELECT COALESCE(TRIM(b.config->>'rebate_program_key'), ''), COALESCE((b.config->>'percent_add')::float8, 0)
		FROM player_vip_state pvs
		JOIN vip_tier_benefits b ON b.tier_id = pvs.tier_id AND b.enabled = true AND b.benefit_type = 'rebate_percent_add'
		WHERE pvs.user_id = $1::uuid AND pvs.tier_id IS NOT NULL
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var key string
		var add float64
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
