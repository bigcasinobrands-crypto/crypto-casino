package adminops

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// maxVIPTierMinWagerMinor prevents pathological tier thresholds (still within BIGINT).
const maxVIPTierMinWagerMinor int64 = 9_000_000_000_000_000

func validateVIPPerksJSON(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	if !json.Valid(raw) {
		return fmt.Errorf("perks must be valid JSON")
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return fmt.Errorf("perks must be a JSON object")
	}
	return nil
}

// mergeCreateVIPTierDefaults ensures new tiers default to hide_from_public_page=true (off ladder)
// unless the caller explicitly set hide_from_public_page in perks JSON.
func mergeCreateVIPTierDefaults(perks json.RawMessage) (json.RawMessage, error) {
	if len(perks) == 0 {
		perks = json.RawMessage(`{}`)
	}
	if err := validateVIPPerksJSON(perks); err != nil {
		return nil, err
	}
	var pm map[string]json.RawMessage
	if err := json.Unmarshal(perks, &pm); err != nil {
		return nil, err
	}
	if pm == nil {
		pm = map[string]json.RawMessage{}
	}
	if _, ok := pm["hide_from_public_page"]; !ok {
		pm["hide_from_public_page"] = json.RawMessage(`true`)
	}
	out, err := json.Marshal(pm)
	if err != nil {
		return nil, err
	}
	return out, validateVIPPerksJSON(out)
}

func (h *Handler) listVIPTiers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, sort_order, name, min_lifetime_wager_minor, perks, created_at
		FROM vip_tiers ORDER BY min_lifetime_wager_minor ASC, id ASC
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
	if strings.TrimSpace(body.Reason) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "reason_required", "reason is required for VIP manual patch")
		return
	}
	if body.TierID == nil && body.Points == nil {
		adminapi.WriteError(w, http.StatusBadRequest, "no_change", "at least one of tier_id or points_balance must be provided")
		return
	}
	ctx := r.Context()

	// Snapshot the BEFORE state so the audit log captures both sides.
	var oldTierID *int
	var oldPoints, oldLifeWager int64
	hadVIPRow := true
	switch err := h.Pool.QueryRow(ctx, `
		SELECT tier_id, COALESCE(points_balance, 0), COALESCE(lifetime_wager_minor, 0)
		FROM player_vip_state WHERE user_id = $1::uuid
	`, uid).Scan(&oldTierID, &oldPoints, &oldLifeWager); err {
	case pgx.ErrNoRows:
		oldTierID, oldPoints, oldLifeWager = nil, 0, 0
		hadVIPRow = false
	case nil:
	default:
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "vip state read failed")
		return
	}

	// All writes (tier change, points change, vip_point_ledger correction row)
	// happen in a single transaction so an audit-visible record always exists.
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "tx begin failed")
		return
	}
	defer tx.Rollback(ctx)

	if body.TierID != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
			VALUES ($1::uuid, $2, 0, 0, now())
			ON CONFLICT (user_id) DO UPDATE SET tier_id = EXCLUDED.tier_id, updated_at = now()
		`, uid, *body.TierID); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "tier update failed")
			return
		}
	}

	if body.Points != nil {
		// Compute the delta vs current and write a vip_point_ledger correction
		// row. This keeps the points audit trail honest — without it, an admin
		// could rewrite points_balance without leaving any record in the
		// per-row ledger that VIP reconciliation depends on.
		delta := *body.Points - oldPoints
		idem := fmt.Sprintf("vip:admin_correction:%s:%s:%d", staffID, uid, time.Now().UTC().UnixNano())
		reason := "admin_correction:" + staffID
		if delta != 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO vip_point_ledger (user_id, delta, reason, idempotency_key)
				VALUES ($1::uuid, $2, $3, $4)
			`, uid, delta, reason, idem); err != nil {
				adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "vip_point_ledger insert failed")
				return
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
			VALUES ($1::uuid, NULL, $2, 0, now())
			ON CONFLICT (user_id) DO UPDATE SET points_balance = $2, updated_at = now()
		`, uid, *body.Points); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "points update failed")
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "commit failed")
		return
	}

	// Tier upgrade hooks (rebate/grant/level-up benefits) run AFTER commit so
	// they observe the new tier. Only fire if the new tier strictly outranks
	// the previous one — manual demotions shouldn't trigger upgrade rewards.
	if body.TierID != nil {
		newTierID := body.TierID
		oldSO := -1
		if hadVIPRow && oldTierID != nil {
			if s, ok := bonus.TierSortOrder(ctx, h.Pool, oldTierID); ok {
				oldSO = s
			}
		}
		newSO, newOk := bonus.TierSortOrder(ctx, h.Pool, newTierID)
		if newOk && newSO > oldSO {
			bonus.ApplyVIPTierUpgrade(ctx, h.Pool, uid, oldTierID, newTierID, oldLifeWager)
		}
	}

	auditMeta := map[string]any{
		"user_id": uid,
		"reason":  body.Reason,
		"before":  map[string]any{"tier_id": oldTierID, "points_balance": oldPoints, "had_vip_row": hadVIPRow},
		"after":   map[string]any{},
	}
	if body.TierID != nil {
		auditMeta["after"].(map[string]any)["tier_id"] = *body.TierID
	}
	if body.Points != nil {
		auditMeta["after"].(map[string]any)["points_balance"] = *body.Points
		auditMeta["points_delta"] = *body.Points - oldPoints
	}
	auditMetaBytes, _ := json.Marshal(auditMeta)
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'vip.manual_patch', 'player_vip_state', $2, $3::jsonb)
	`, staffID, uid, auditMetaBytes); err != nil {
		log.Printf("admin_audit_log vip.manual_patch insert failed user=%s staff=%s: %v", uid, staffID, err)
	}
	writeJSON(w, map[string]any{"ok": true})
}

type patchVIPTierBody struct {
	Name                  *string         `json:"name"`
	MinLifetimeWagerMinor *int64          `json:"min_lifetime_wager_minor"`
	Perks                 json.RawMessage `json:"perks"`
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
	var name string
	var minW int64
	var perks []byte
	err = h.Pool.QueryRow(ctx, `
		SELECT name, min_lifetime_wager_minor, perks FROM vip_tiers WHERE id = $1
	`, id).Scan(&name, &minW, &perks)
	if err == pgx.ErrNoRows {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "tier not found")
		return
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		name = strings.TrimSpace(*body.Name)
	}
	if body.MinLifetimeWagerMinor != nil {
		minW = *body.MinLifetimeWagerMinor
	}
	if len(body.Perks) > 0 {
		if err := validateVIPPerksJSON(body.Perks); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		perks = body.Perks
	}
	name = strings.TrimSpace(name)
	if name == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "tier name is required")
		return
	}
	if minW < 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "min_lifetime_wager_minor must be >= 0")
		return
	}
	if minW > maxVIPTierMinWagerMinor {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "min_lifetime_wager_minor exceeds maximum allowed")
		return
	}
	_, err = h.Pool.Exec(ctx, `
		UPDATE vip_tiers SET name = $2, min_lifetime_wager_minor = $3, perks = $4::jsonb
		WHERE id = $1
	`, id, name, minW, perks)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	recomputeVIPTierSortOrder(ctx, h.Pool)
	if _, rerr := bonus.ResyncAllPlayerVIPTiers(ctx, h.Pool); rerr != nil {
		log.Printf("vip ResyncAllPlayerVIPTiers after patch tier: %v", rerr)
	}
	meta, _ := json.Marshal(map[string]any{"tier_id": id, "name": name, "min_lifetime_wager_minor": minW})
	h.auditExec(ctx, "vip.patch_tier", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.patch_tier', 'vip_tiers', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) createVIPTier(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body struct {
		Name             string          `json:"name"`
		MinLifetimeWager int64           `json:"min_lifetime_wager_minor"`
		Perks            json.RawMessage `json:"perks"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "invalid body")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "name required")
		return
	}
	if body.MinLifetimeWager < 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "min_lifetime_wager_minor must be >= 0")
		return
	}
	if body.MinLifetimeWager > maxVIPTierMinWagerMinor {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "min_lifetime_wager_minor exceeds maximum allowed")
		return
	}
	perksMerged, err := mergeCreateVIPTierDefaults(body.Perks)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	var id int
	err = h.Pool.QueryRow(r.Context(), `
		INSERT INTO vip_tiers (sort_order, name, min_lifetime_wager_minor, perks)
		VALUES (0, $1, $2, $3::jsonb) RETURNING id
	`, name, body.MinLifetimeWager, perksMerged).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	recomputeVIPTierSortOrder(r.Context(), h.Pool)
	if _, rerr := bonus.ResyncAllPlayerVIPTiers(r.Context(), h.Pool); rerr != nil {
		log.Printf("vip ResyncAllPlayerVIPTiers after create tier: %v", rerr)
	}
	meta, _ := json.Marshal(map[string]any{"tier_id": id, "name": name, "min_lifetime_wager_minor": body.MinLifetimeWager})
	h.auditExec(r.Context(), "vip.create_tier", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.create_tier', 'vip_tiers', $2::jsonb)
	`, staffID, meta)
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
	SortOrder          int             `json:"sort_order"`
	Enabled            *bool           `json:"enabled"`
	BenefitType        string          `json:"benefit_type"`
	PromotionVersionID *int64          `json:"promotion_version_id"`
	Config             json.RawMessage `json:"config"`
	PlayerTitle        *string         `json:"player_title"`
	PlayerDescription  *string         `json:"player_description"`
}

var hhmmUTCRe = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

func validateRakebackBoostScheduleConfig(cm map[string]any) string {
	key, _ := cm["rebate_program_key"].(string)
	if strings.TrimSpace(key) == "" {
		return "rakeback_boost_schedule requires config.rebate_program_key"
	}
	boost, _ := cm["boost_percent_add"].(float64)
	if boost <= 0 {
		return "rakeback_boost_schedule requires config.boost_percent_add > 0"
	}
	windows, _ := cm["windows"].([]any)
	if len(windows) == 0 {
		return "rakeback_boost_schedule requires at least one window"
	}
	for _, raw := range windows {
		wm, ok := raw.(map[string]any)
		if !ok {
			return "rakeback_boost_schedule windows must be objects"
		}
		start, _ := wm["start_utc"].(string)
		if !hhmmUTCRe.MatchString(strings.TrimSpace(start)) {
			return "rakeback_boost_schedule window start_utc must be HH:MM UTC"
		}
		claim, _ := wm["claim_window_minutes"].(float64)
		if int(claim) <= 0 {
			return "rakeback_boost_schedule requires claim_window_minutes > 0 for each window"
		}
		boostDuration, _ := wm["boost_duration_minutes"].(float64)
		if int(boostDuration) <= 0 {
			return "rakeback_boost_schedule requires boost_duration_minutes > 0 for each window"
		}
	}
	return ""
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
	if btype != "grant_promotion" && btype != "rebate_percent_add" && btype != "vip_card_feature" && btype != "level_up_cash_percent" && btype != "rakeback_boost_schedule" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_type", "benefit_type must be grant_promotion, rebate_percent_add, vip_card_feature, level_up_cash_percent, or rakeback_boost_schedule")
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
	} else if btype == "rebate_percent_add" {
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
	} else if btype == "vip_card_feature" {
		// vip_card_feature: config-driven card row content for player VIP cards.
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		title, _ := cm["title"].(string)
		subtitle, _ := cm["subtitle"].(string)
		if strings.TrimSpace(title) == "" && strings.TrimSpace(subtitle) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "vip_card_feature requires config.title and/or config.subtitle")
			return
		}
		pv = nil
	} else if btype == "level_up_cash_percent" {
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		pct, _ := cm["percent_of_previous_level_wager"].(float64)
		if int(pct) <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "level_up_cash_percent requires config.percent_of_previous_level_wager > 0")
			return
		}
		pv = nil
	} else {
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		if msg := validateRakebackBoostScheduleConfig(cm); msg != "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", msg)
			return
		}
		pv = nil
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
	h.auditExec(ctx, "vip.create_tier_benefit", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.create_tier_benefit', 'vip_tier_benefits', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"id": id})
}

type patchVIPTierBenefitBody struct {
	SortOrder          *int            `json:"sort_order"`
	Enabled            *bool           `json:"enabled"`
	BenefitType        *string         `json:"benefit_type"`
	PromotionVersionID *int64          `json:"promotion_version_id"`
	Config             json.RawMessage `json:"config"`
	PlayerTitle        *string         `json:"player_title"`
	PlayerDescription  *string         `json:"player_description"`
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
		if nextType != "grant_promotion" && nextType != "rebate_percent_add" && nextType != "vip_card_feature" && nextType != "level_up_cash_percent" && nextType != "rakeback_boost_schedule" {
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
	} else if nextType == "rebate_percent_add" {
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
	} else if nextType == "vip_card_feature" {
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		title, _ := cm["title"].(string)
		subtitle, _ := cm["subtitle"].(string)
		if strings.TrimSpace(title) == "" && strings.TrimSpace(subtitle) == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "vip_card_feature requires config.title and/or config.subtitle")
			return
		}
		nextPV = nil
	} else if nextType == "level_up_cash_percent" {
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		paF, _ := cm["percent_of_previous_level_wager"].(float64)
		if int(paF) <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", "level_up_cash_percent requires config.percent_of_previous_level_wager > 0")
			return
		}
		nextPV = nil
	} else {
		var cm map[string]any
		_ = json.Unmarshal(cfg, &cm)
		if msg := validateRakebackBoostScheduleConfig(cm); msg != "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", msg)
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
	h.auditExec(ctx, "vip.patch_tier_benefit", `
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
	h.auditExec(ctx, "vip.delete_tier_benefit", `
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
		ORDER BY vt.min_lifetime_wager_minor ASC, vt.id ASC
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

	var delivered7d, grantedItems7d, failedItems7d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN result = 'granted' THEN COALESCE(amount_minor, 0) ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN result = 'granted' THEN 1 ELSE 0 END), 0)::bigint,
			COALESCE(SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END), 0)::bigint
		FROM vip_delivery_run_items
		WHERE created_at >= now() - interval '7 days'
	`).Scan(&delivered7d, &grantedItems7d, &failedItems7d)

	var runs7d, runsFailed7d int64
	var avgRunMs *float64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::bigint,
			COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0)::bigint,
			AVG(EXTRACT(EPOCH FROM (COALESCE(finished_at, now()) - started_at)) * 1000.0)
		FROM vip_delivery_runs
		WHERE started_at >= now() - interval '7 days'
	`).Scan(&runs7d, &runsFailed7d, &avgRunMs)

	costByPipelineRows, err := h.Pool.Query(ctx, `
		SELECT pipeline, COALESCE(SUM(CASE WHEN result = 'granted' THEN COALESCE(amount_minor, 0) ELSE 0 END), 0)::bigint
		FROM vip_delivery_run_items
		WHERE created_at >= now() - interval '7 days'
		GROUP BY pipeline
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "pipeline cost stats failed")
		return
	}
	defer costByPipelineRows.Close()
	costByPipeline := map[string]int64{}
	for costByPipelineRows.Next() {
		var p string
		var v int64
		if err := costByPipelineRows.Scan(&p, &v); err != nil {
			continue
		}
		costByPipeline[p] = v
	}

	var successRate float64
	if grantedItems7d+failedItems7d > 0 {
		successRate = float64(grantedItems7d) / float64(grantedItems7d+failedItems7d)
	}

	writeJSON(w, map[string]any{
		"tier_population":        population,
		"players_untiered":       untiered,
		"tier_events_7d":         tierEvents7d,
		"grant_log_7d_by_result": grantByResult,
		"recent_tier_events":     recent,
		"delivery_cost_7d_minor": delivered7d,
		"delivery_items_granted_7d": grantedItems7d,
		"delivery_items_failed_7d":  failedItems7d,
		"delivery_success_rate_7d":  successRate,
		"delivery_runs_7d":          runs7d,
		"delivery_runs_failed_7d":   runsFailed7d,
		"delivery_avg_run_ms_7d":    avgRunMs,
		"delivery_cost_7d_by_pipeline_minor": costByPipeline,
	})
}

// recomputeVIPTierSortOrder sets sort_order so tier rank follows minimum lifetime wager ascending (ties broken by id).
// This keeps delivery / eligibility features that reference sort_order aligned with wagering progression.
func recomputeVIPTierSortOrder(ctx context.Context, pool *pgxpool.Pool) {
	_, _ = pool.Exec(ctx, `
		WITH ranked AS (
			SELECT id, ROW_NUMBER() OVER (ORDER BY min_lifetime_wager_minor ASC, id ASC)::int - 1 AS new_sort
			FROM vip_tiers
		)
		UPDATE vip_tiers v
		SET sort_order = r.new_sort
		FROM ranked r
		WHERE v.id = r.id AND v.sort_order IS DISTINCT FROM r.new_sort
	`)
}
