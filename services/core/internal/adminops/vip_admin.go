package adminops

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (h *Handler) listVIPTiers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, sort_order, name, min_lifetime_wager_minor, perks, created_at
		FROM vip_tiers ORDER BY sort_order ASC, id ASC
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, sort int
		var name string
		var minW int64
		var perks []byte
		var ct time.Time
		if err := rows.Scan(&id, &sort, &name, &minW, &perks, &ct); err != nil {
			continue
		}
		var pm map[string]any
		_ = json.Unmarshal(perks, &pm)
		list = append(list, map[string]any{
			"id": id, "sort_order": sort, "name": name,
			"min_lifetime_wager_minor": minW, "perks": pm,
			"created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"tiers": list})
}

func (h *Handler) getUserVIP(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "id")
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	ctx := r.Context()
	var tierID *int
	var points, life int64
	var lat *time.Time
	err := h.Pool.QueryRow(ctx, `
		SELECT tier_id, points_balance, lifetime_wager_minor, last_accrual_at
		FROM player_vip_state WHERE user_id = $1::uuid
	`, uid).Scan(&tierID, &points, &life, &lat)
	if err == pgx.ErrNoRows {
		writeJSON(w, map[string]any{"user_id": uid, "tier_id": nil, "points_balance": 0, "lifetime_wager_minor": 0})
		return
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	out := map[string]any{"user_id": uid, "points_balance": points, "lifetime_wager_minor": life}
	if tierID != nil {
		out["tier_id"] = *tierID
	}
	if lat != nil {
		out["last_accrual_at"] = lat.UTC().Format(time.RFC3339)
	}
	writeJSON(w, out)
}

type patchUserVIPBody struct {
	TierID *int   `json:"tier_id"`
	Points *int64 `json:"points_balance"`
	Reason string `json:"reason"`
}

func (h *Handler) patchUserVIP(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	uid := chi.URLParam(r, "id")
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	var body patchUserVIPBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	ctx := r.Context()
	if body.TierID != nil {
		var oldTierID *int
		var lifeWager int64
		switch err := h.Pool.QueryRow(ctx, `
			SELECT tier_id, COALESCE(lifetime_wager_minor, 0) FROM player_vip_state WHERE user_id = $1::uuid
		`, uid).Scan(&oldTierID, &lifeWager); err {
		case pgx.ErrNoRows:
			oldTierID, lifeWager = nil, 0
		case nil:
		default:
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "vip state read failed")
			return
		}
		_, _ = h.Pool.Exec(ctx, `
			INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
			VALUES ($1::uuid, $2, 0, 0, now())
			ON CONFLICT (user_id) DO UPDATE SET tier_id = EXCLUDED.tier_id, updated_at = now()
		`, uid, *body.TierID)
		newTierID := body.TierID
		oldSO := -1
		if oldTierID != nil {
			if s, ok := bonus.TierSortOrder(ctx, h.Pool, oldTierID); ok {
				oldSO = s
			}
		}
		newSO, newOk := bonus.TierSortOrder(ctx, h.Pool, newTierID)
		if newOk && newSO > oldSO {
			bonus.ApplyVIPTierUpgrade(ctx, h.Pool, uid, oldTierID, newTierID, lifeWager)
		}
	}
	if body.Points != nil {
		_, _ = h.Pool.Exec(ctx, `
			INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
			VALUES ($1::uuid, (SELECT id FROM vip_tiers ORDER BY sort_order ASC LIMIT 1), $2, 0, now())
			ON CONFLICT (user_id) DO UPDATE SET points_balance = $2, updated_at = now()
		`, uid, *body.Points)
	}
	meta, _ := json.Marshal(map[string]any{"user_id": uid, "reason": body.Reason})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.manual_patch', 'player_vip_state', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}

type patchVIPTierBody struct {
	SortOrder               *int            `json:"sort_order"`
	Name                    *string         `json:"name"`
	MinLifetimeWagerMinor   *int64          `json:"min_lifetime_wager_minor"`
	Perks                   json.RawMessage `json:"perks"`
}

func (h *Handler) patchVIPTier(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid id")
		return
	}
	var body patchVIPTierBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	ctx := r.Context()
	var sort int
	var name string
	var minW int64
	var perks []byte
	err = h.Pool.QueryRow(ctx, `
		SELECT sort_order, name, min_lifetime_wager_minor, perks FROM vip_tiers WHERE id = $1
	`, id).Scan(&sort, &name, &minW, &perks)
	if err == pgx.ErrNoRows {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "tier not found")
		return
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	if body.SortOrder != nil {
		sort = *body.SortOrder
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		name = strings.TrimSpace(*body.Name)
	}
	if body.MinLifetimeWagerMinor != nil {
		minW = *body.MinLifetimeWagerMinor
	}
	if len(body.Perks) > 0 {
		perks = body.Perks
	}
	_, err = h.Pool.Exec(ctx, `
		UPDATE vip_tiers SET sort_order = $2, name = $3, min_lifetime_wager_minor = $4, perks = $5::jsonb
		WHERE id = $1
	`, id, sort, name, minW, perks)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	meta, _ := json.Marshal(map[string]any{"tier_id": id, "sort_order": sort, "name": name})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.patch_tier', 'vip_tiers', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) createVIPTier(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name                 string          `json:"name"`
		SortOrder            int             `json:"sort_order"`
		MinLifetimeWager     int64           `json:"min_lifetime_wager_minor"`
		Perks                json.RawMessage `json:"perks"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "name required")
		return
	}
	perks := body.Perks
	if len(perks) == 0 {
		perks = json.RawMessage(`{}`)
	}
	var id int
	err := h.Pool.QueryRow(r.Context(), `
		INSERT INTO vip_tiers (sort_order, name, min_lifetime_wager_minor, perks)
		VALUES ($1, $2, $3, $4::jsonb) RETURNING id
	`, body.SortOrder, body.Name, body.MinLifetimeWager, perks).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	writeJSON(w, map[string]any{"id": id})
}

func (h *Handler) listVIPPlayers(w http.ResponseWriter, r *http.Request) {
	tier := r.URL.Query().Get("tier_id")
	ctx := r.Context()
	var rows pgx.Rows
	var err error
	if tier != "" {
		tid, _ := strconv.Atoi(tier)
		rows, err = h.Pool.Query(ctx, `
			SELECT pvs.user_id::text, u.email, pvs.tier_id, pvs.points_balance
			FROM player_vip_state pvs
			JOIN users u ON u.id = pvs.user_id
			WHERE pvs.tier_id = $1
			ORDER BY pvs.updated_at DESC LIMIT 200
		`, tid)
	} else {
		rows, err = h.Pool.Query(ctx, `
			SELECT pvs.user_id::text, u.email, pvs.tier_id, pvs.points_balance
			FROM player_vip_state pvs
			JOIN users u ON u.id = pvs.user_id
			ORDER BY pvs.updated_at DESC LIMIT 200
		`)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var uid, email string
		var tid *int
		var pts int64
		if err := rows.Scan(&uid, &email, &tid, &pts); err != nil {
			continue
		}
		m := map[string]any{"user_id": uid, "email": email, "points_balance": pts}
		if tid != nil {
			m["tier_id"] = *tid
		}
		list = append(list, m)
	}
	writeJSON(w, map[string]any{"players": list})
}

func promotionVersionPublished(ctx context.Context, pool *pgxpool.Pool, pvID int64) (ok bool, err error) {
	var pubAt *time.Time
	err = pool.QueryRow(ctx, `SELECT published_at FROM promotion_versions WHERE id = $1`, pvID).Scan(&pubAt)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return pubAt != nil, nil
}

func (h *Handler) listVIPTierBenefits(w http.ResponseWriter, r *http.Request) {
	tid, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || tid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid tier id")
		return
	}
	ctx := r.Context()
	if err := h.Pool.QueryRow(ctx, `SELECT 1 FROM vip_tiers WHERE id = $1`, tid).Scan(new(int)); err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "tier not found")
		return
	}
	rows, err := h.Pool.Query(ctx, `
		SELECT id, tier_id, sort_order, enabled, benefit_type, promotion_version_id, config,
			player_title, player_description, created_at, updated_at
		FROM vip_tier_benefits
		WHERE tier_id = $1
		ORDER BY sort_order ASC, id ASC
	`, tid)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var tierID, sort int
		var enabled bool
		var btype string
		var pv *int64
		var cfg []byte
		var title, desc *string
		var ca, ua time.Time
		if err := rows.Scan(&id, &tierID, &sort, &enabled, &btype, &pv, &cfg, &title, &desc, &ca, &ua); err != nil {
			continue
		}
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		m := map[string]any{
			"id": id, "tier_id": tierID, "sort_order": sort, "enabled": enabled,
			"benefit_type": btype, "config": cm,
			"created_at": ca.UTC().Format(time.RFC3339), "updated_at": ua.UTC().Format(time.RFC3339),
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
		list = append(list, m)
	}
	writeJSON(w, map[string]any{"benefits": list})
}

type createVIPTierBenefitBody struct {
	SortOrder            int             `json:"sort_order"`
	Enabled              *bool           `json:"enabled"`
	BenefitType          string          `json:"benefit_type"`
	PromotionVersionID   *int64          `json:"promotion_version_id"`
	Config               json.RawMessage `json:"config"`
	PlayerTitle          *string         `json:"player_title"`
	PlayerDescription    *string         `json:"player_description"`
}

func (h *Handler) createVIPTierBenefit(w http.ResponseWriter, r *http.Request) {
	tid, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || tid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid tier id")
		return
	}
	ctx := r.Context()
	if err := h.Pool.QueryRow(ctx, `SELECT 1 FROM vip_tiers WHERE id = $1`, tid).Scan(new(int)); err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "tier not found")
		return
	}
	var body createVIPTierBenefitBody
	if decErr := json.NewDecoder(r.Body).Decode(&body); decErr != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	btype := strings.TrimSpace(strings.ToLower(body.BenefitType))
	if btype != "grant_promotion" && btype != "rebate_percent_add" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_type", "benefit_type must be grant_promotion or rebate_percent_add")
		return
	}
	cfg := body.Config
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	var pv *int64
	if btype == "grant_promotion" {
		if body.PromotionVersionID == nil || *body.PromotionVersionID <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_pv", "promotion_version_id required for grant_promotion")
			return
		}
		pub, err := promotionVersionPublished(ctx, h.Pool, *body.PromotionVersionID)
		if err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "pv lookup failed")
			return
		}
		if !pub {
			adminapi.WriteError(w, http.StatusBadRequest, "not_published", "promotion version must be published")
			return
		}
		pv = body.PromotionVersionID
	} else {
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		key, _ := cm["rebate_program_key"].(string)
		if strings.TrimSpace(key) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "config.rebate_program_key required for rebate_percent_add")
			return
		}
		pa, _ := cm["percent_add"].(float64)
		if int(pa) <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "config.percent_add must be > 0")
			return
		}
	}
	staffID, _ := adminapi.StaffIDFromContext(r.Context())
	var id int64
	err = h.Pool.QueryRow(ctx, `
		INSERT INTO vip_tier_benefits (tier_id, sort_order, enabled, benefit_type, promotion_version_id, config, player_title, player_description)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
		RETURNING id
	`, tid, body.SortOrder, enabled, btype, pv, cfg, body.PlayerTitle, body.PlayerDescription).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	meta, _ := json.Marshal(map[string]any{"tier_id": tid, "benefit_id": id, "benefit_type": btype})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.create_tier_benefit', 'vip_tier_benefits', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"id": id})
}

type patchVIPTierBenefitBody struct {
	SortOrder            *int            `json:"sort_order"`
	Enabled              *bool           `json:"enabled"`
	BenefitType          *string         `json:"benefit_type"`
	PromotionVersionID   *int64          `json:"promotion_version_id"`
	Config               json.RawMessage `json:"config"`
	PlayerTitle          *string         `json:"player_title"`
	PlayerDescription    *string         `json:"player_description"`
}

func (h *Handler) patchVIPTierBenefit(w http.ResponseWriter, r *http.Request) {
	tid, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || tid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid tier id")
		return
	}
	bid, err := strconv.ParseInt(chi.URLParam(r, "bid"), 10, 64)
	if err != nil || bid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid benefit id")
		return
	}
	var body patchVIPTierBenefitBody
	if decErr := json.NewDecoder(r.Body).Decode(&body); decErr != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	ctx := r.Context()
	var curType string
	var curSort int
	var curEn bool
	var curCfg []byte
	var curPV *int64
	var curTitle, curDesc *string
	err = h.Pool.QueryRow(ctx, `
		SELECT benefit_type, sort_order, enabled, config, promotion_version_id, player_title, player_description
		FROM vip_tier_benefits WHERE id = $1 AND tier_id = $2
	`, bid, tid).Scan(&curType, &curSort, &curEn, &curCfg, &curPV, &curTitle, &curDesc)
	if err == pgx.ErrNoRows {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "benefit not found")
		return
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	nextType := curType
	if body.BenefitType != nil && strings.TrimSpace(*body.BenefitType) != "" {
		nextType = strings.TrimSpace(strings.ToLower(*body.BenefitType))
		if nextType != "grant_promotion" && nextType != "rebate_percent_add" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_type", "invalid benefit_type")
			return
		}
	}
	sort := curSort
	if body.SortOrder != nil {
		sort = *body.SortOrder
	}
	en := curEn
	if body.Enabled != nil {
		en = *body.Enabled
	}
	cfg := curCfg
	if len(body.Config) > 0 {
		cfg = body.Config
	}
	nextPV := curPV
	if body.PromotionVersionID != nil {
		nextPV = body.PromotionVersionID
	}
	title := curTitle
	if body.PlayerTitle != nil {
		title = body.PlayerTitle
	}
	desc := curDesc
	if body.PlayerDescription != nil {
		desc = body.PlayerDescription
	}
	if nextType == "grant_promotion" {
		if nextPV == nil || *nextPV <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_pv", "promotion_version_id required for grant_promotion")
			return
		}
		pub, perr := promotionVersionPublished(ctx, h.Pool, *nextPV)
		if perr != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "pv lookup failed")
			return
		}
		if !pub {
			adminapi.WriteError(w, http.StatusBadRequest, "not_published", "promotion version must be published")
			return
		}
	} else {
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		key, _ := cm["rebate_program_key"].(string)
		if strings.TrimSpace(key) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "config.rebate_program_key required for rebate_percent_add")
			return
		}
		paF, _ := cm["percent_add"].(float64)
		pa := int(paF)
		if pa <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "config.percent_add must be > 0")
			return
		}
		nextPV = nil
	}

	_, err = h.Pool.Exec(ctx, `
		UPDATE vip_tier_benefits SET
			sort_order = $3, enabled = $4, benefit_type = $5, config = $6::jsonb,
			promotion_version_id = $7, player_title = $8, player_description = $9, updated_at = now()
		WHERE id = $1 AND tier_id = $2
	`, bid, tid, sort, en, nextType, cfg, nextPV, title, desc)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	staffID, _ := adminapi.StaffIDFromContext(r.Context())
	meta, _ := json.Marshal(map[string]any{"tier_id": tid, "benefit_id": bid})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.patch_tier_benefit', 'vip_tier_benefits', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) deleteVIPTierBenefit(w http.ResponseWriter, r *http.Request) {
	tid, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || tid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid tier id")
		return
	}
	bid, err := strconv.ParseInt(chi.URLParam(r, "bid"), 10, 64)
	if err != nil || bid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid benefit id")
		return
	}
	ctx := r.Context()
	tag, err := h.Pool.Exec(ctx, `DELETE FROM vip_tier_benefits WHERE id = $1 AND tier_id = $2`, bid, tid)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "benefit not found")
		return
	}
	staffID, _ := adminapi.StaffIDFromContext(r.Context())
	meta, _ := json.Marshal(map[string]any{"tier_id": tid, "benefit_id": bid})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.delete_tier_benefit', 'vip_tier_benefits', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) vipDeliverySummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var tierEvents7d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM vip_tier_events WHERE created_at >= now() - interval '7 days'
	`).Scan(&tierEvents7d)

	popRows, err := h.Pool.Query(ctx, `
		SELECT vt.id, vt.name, vt.sort_order, COUNT(pvs.user_id)::bigint
		FROM vip_tiers vt
		LEFT JOIN player_vip_state pvs ON pvs.tier_id = vt.id
		GROUP BY vt.id, vt.name, vt.sort_order
		ORDER BY vt.sort_order ASC, vt.id ASC
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "population query failed")
		return
	}
	defer popRows.Close()
	var population []map[string]any
	for popRows.Next() {
		var id, sort int
		var name string
		var n int64
		if err := popRows.Scan(&id, &name, &sort, &n); err != nil {
			continue
		}
		population = append(population, map[string]any{
			"tier_id": id, "name": name, "sort_order": sort, "player_count": n,
		})
	}

	var untiered int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM player_vip_state WHERE tier_id IS NULL
	`).Scan(&untiered)

	grRows, err := h.Pool.Query(ctx, `
		SELECT result, COUNT(*)::bigint FROM vip_tier_grant_log
		WHERE created_at >= now() - interval '7 days'
		GROUP BY result
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "grant stats failed")
		return
	}
	defer grRows.Close()
	grantByResult := map[string]int64{}
	for grRows.Next() {
		var res string
		var c int64
		if err := grRows.Scan(&res, &c); err != nil {
			continue
		}
		grantByResult[res] = c
	}

	evRows, err := h.Pool.Query(ctx, `
		SELECT id, user_id::text, from_tier_id, to_tier_id, lifetime_wager_minor, meta, created_at
		FROM vip_tier_events
		ORDER BY created_at DESC
		LIMIT 50
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "events query failed")
		return
	}
	defer evRows.Close()
	var recent []map[string]any
	for evRows.Next() {
		var id int64
		var uid string
		var fromT, toT *int
		var life int64
		var meta []byte
		var ct time.Time
		if err := evRows.Scan(&id, &uid, &fromT, &toT, &life, &meta, &ct); err != nil {
			continue
		}
		var mm map[string]any
		_ = json.Unmarshal(meta, &mm)
		m := map[string]any{
			"id": id, "user_id": uid, "lifetime_wager_minor": life, "meta": mm,
			"created_at": ct.UTC().Format(time.RFC3339),
		}
		if fromT != nil {
			m["from_tier_id"] = *fromT
		}
		if toT != nil {
			m["to_tier_id"] = *toT
		}
		recent = append(recent, m)
	}

	writeJSON(w, map[string]any{
		"tier_population":       population,
		"players_untiered":      untiered,
		"tier_events_7d":        tierEvents7d,
		"grant_log_7d_by_result": grantByResult,
		"recent_tier_events":    recent,
	})
}
