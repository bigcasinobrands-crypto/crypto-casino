package bonus

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func humanizeRebateProgramKey(key string) string {
	k := strings.TrimSpace(key)
	if k == "" {
		return "rebate programme"
	}
	parts := strings.Split(k, "_")
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + strings.ToLower(p[1:])
	}
	return strings.Join(parts, " ")
}

// vipTierGrantIdempotencyKey matches ApplyVIPTierUpgrade grant_promotion idempotency.
func vipTierGrantIdempotencyKey(tierID int, benefitID int64, userID string, pvID int64) string {
	return fmt.Sprintf("vip:tier_up:tier:%d:benefit:%d:user:%s:pv:%d", tierID, benefitID, userID, pvID)
}

// VipTierPerkCardsForUser returns tier_perks for GET /v1/vip/status: titles, copy, and active|claimable|pending|unavailable.
func VipTierPerkCardsForUser(ctx context.Context, pool *pgxpool.Pool, userID string, tierID int, country string) ([]map[string]any, error) {
	offers, err := ListAvailableOffersForPlayer(ctx, pool, userID, country)
	if err != nil {
		return nil, err
	}
	offerPV := make(map[int64]struct{})
	for _, o := range offers {
		if v, ok := promotionVersionIDFromOfferMapLocal(o); ok && v > 0 {
			offerPV[v] = struct{}{}
		}
	}

	rows, err := pool.Query(ctx, `
		SELECT b.id, b.benefit_type, b.promotion_version_id, b.config, b.player_title, b.player_description, b.sort_order,
			COALESCE(NULLIF(TRIM(pv.player_title), ''), NULLIF(TRIM(p.name), '')),
			COALESCE(NULLIF(TRIM(pv.player_description), ''), '')
		FROM vip_tier_benefits b
		LEFT JOIN promotion_versions pv ON pv.id = b.promotion_version_id
		LEFT JOIN promotions p ON p.id = pv.promotion_id
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
		var pTitle, pDesc *string
		var promoTitleJoin, promoDescJoin string
		if err := rows.Scan(&id, &btype, &pv, &cfg, &pTitle, &pDesc, &sort, &promoTitleJoin, &promoDescJoin); err != nil {
			continue
		}
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)

		item := map[string]any{
			"benefit_id":   id,
			"benefit_type": btype,
			"sort_order":   sort,
		}

		switch btype {
		case "rebate_percent_add":
			key := ""
			pct := 0
			if cm != nil {
				if s, ok := cm["rebate_program_key"].(string); ok {
					key = strings.TrimSpace(s)
				}
				switch v := cm["percent_add"].(type) {
				case float64:
					pct = int(v)
				case int:
					pct = v
				}
			}
			title := strings.TrimSpace(ptrStr(pTitle))
			if title == "" {
				if pct > 0 && key != "" {
					title = fmt.Sprintf("+%d%% %s", pct, humanizeRebateProgramKey(key))
				} else if pct > 0 {
					title = fmt.Sprintf("+%d%% rebate boost", pct)
				} else {
					title = "Rebate boost"
				}
			}
			desc := strings.TrimSpace(ptrStr(pDesc))
			if desc == "" && key != "" {
				desc = fmt.Sprintf("Stacks on the %s programme.", humanizeRebateProgramKey(key))
			}
			item["title"] = title
			item["description"] = desc
			item["state"] = "active"
			item["deep_link"] = "/bonuses"

		case "vip_card_feature":
			cfgTitle := ""
			cfgSubtitle := ""
			cfgIcon := ""
			if cm != nil {
				if s, ok := cm["title"].(string); ok {
					cfgTitle = strings.TrimSpace(s)
				}
				if s, ok := cm["subtitle"].(string); ok {
					cfgSubtitle = strings.TrimSpace(s)
				}
				if s, ok := cm["icon_key"].(string); ok {
					cfgIcon = strings.TrimSpace(s)
				}
			}
			title := cfgTitle
			if title == "" {
				title = strings.TrimSpace(ptrStr(pTitle))
			}
			if title == "" {
				title = "VIP perk"
			}
			desc := cfgSubtitle
			if desc == "" {
				desc = strings.TrimSpace(ptrStr(pDesc))
			}
			item["title"] = title
			item["description"] = desc
			if cfgIcon != "" {
				item["icon_key"] = cfgIcon
			}
			item["state"] = "active"
			item["deep_link"] = "/bonuses"

		case "grant_promotion":
			if pv == nil || *pv <= 0 {
				item["title"] = strings.TrimSpace(ptrStr(pTitle))
				if item["title"] == "" {
					item["title"] = "Tier promotion"
				}
				item["description"] = strings.TrimSpace(ptrStr(pDesc))
				item["state"] = "unavailable"
				item["deep_link"] = "/bonuses"
				out = append(out, item)
				continue
			}
			pvID := *pv
			item["promotion_version_id"] = pvID
			idem := vipTierGrantIdempotencyKey(tierID, id, userID, pvID)

			title := strings.TrimSpace(ptrStr(pTitle))
			if title == "" {
				title = strings.TrimSpace(promoTitleJoin)
			}
			if title == "" {
				title = "VIP bonus"
			}
			desc := strings.TrimSpace(ptrStr(pDesc))
			if desc == "" {
				desc = strings.TrimSpace(promoDescJoin)
			}
			if desc == "" {
				desc = "Promotion attached to this tier."
			}
			item["title"] = title
			item["description"] = desc

			var instStatus, instID string
			errInst := pool.QueryRow(ctx, `
				SELECT status, id::text FROM user_bonus_instances
				WHERE user_id = $1::uuid AND idempotency_key = $2
				ORDER BY created_at DESC LIMIT 1
			`, userID, idem).Scan(&instStatus, &instID)
			if errInst == nil {
				item["bonus_instance_id"] = instID
				switch strings.ToLower(strings.TrimSpace(instStatus)) {
				case "pending", "pending_review":
					item["state"] = "claimable"
					item["deep_link"] = "/bonuses"
				case "active", "completed":
					item["state"] = "active"
					item["deep_link"] = "/bonuses"
				default:
					item["state"] = "unavailable"
					item["deep_link"] = "/bonuses"
				}
				out = append(out, item)
				continue
			}
			if errInst != pgx.ErrNoRows {
				return nil, errInst
			}

			var glResult string
			errGl := pool.QueryRow(ctx, `
				SELECT result FROM vip_tier_grant_log
				WHERE user_id = $1::uuid AND tier_id = $2 AND benefit_id = $3
			`, userID, tierID, id).Scan(&glResult)
			if errGl == nil {
				switch strings.ToLower(strings.TrimSpace(glResult)) {
				case "granted":
					item["state"] = "active"
				case "error", "skipped":
					if _, ok := offerPV[pvID]; ok {
						item["state"] = "claimable"
					} else {
						item["state"] = "unavailable"
					}
				default:
					if _, ok := offerPV[pvID]; ok {
						item["state"] = "claimable"
					} else {
						item["state"] = "pending"
					}
				}
			} else if errGl == pgx.ErrNoRows {
				if _, ok := offerPV[pvID]; ok {
					item["state"] = "claimable"
				} else {
					item["state"] = "pending"
				}
			} else {
				return nil, errGl
			}
			item["deep_link"] = "/bonuses"

		default:
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func ptrStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
