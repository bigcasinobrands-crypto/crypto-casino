package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (h *Handler) bonusHubActiveOffers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Pool.Query(ctx, `
		SELECT pv.id, pv.promotion_id, p.name, pv.published_at, pv.valid_from, pv.valid_to,
			COALESCE(p.grants_paused, false), COALESCE(p.vip_only, false), pv.priority,
			(SELECT COUNT(*)::bigint FROM user_bonus_instances bi WHERE bi.promotion_version_id = pv.id AND bi.status = 'active') AS active_n,
			(SELECT COUNT(*)::bigint FROM user_bonus_instances bi WHERE bi.promotion_version_id = pv.id AND bi.created_at > now() - interval '24 hours') AS grants_24h
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE pv.published_at IS NOT NULL
		  AND p.status != 'archived'
		  AND COALESCE(p.grants_paused, false) = false
		ORDER BY pv.published_at DESC
		LIMIT 200
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var vid, pid int64
		var name string
		var pubAt time.Time
		var vf, vt *time.Time
		var paused bool
		var vipOnly bool
		var pri int
		var activeN, g24 int64
		if err := rows.Scan(&vid, &pid, &name, &pubAt, &vf, &vt, &paused, &vipOnly, &pri, &activeN, &g24); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"promotion_version_id": vid, "promotion_id": pid, "promotion_name": name,
			"published_at": pubAt.UTC().Format(time.RFC3339),
			"valid_from":   nullRFC3339(vf), "valid_to": nullRFC3339(vt),
			"grants_paused": paused, "vip_only": vipOnly, "priority": pri,
			"active_instances": activeN, "grants_last_24h": g24,
		})
	}
	writeJSON(w, map[string]any{"offers": list})
}

func nullRFC3339(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func (h *Handler) bonusHubVersionPerformance(w http.ResponseWriter, r *http.Request) {
	vid, err := strconv.ParseInt(chi.URLParam(r, "vid"), 10, 64)
	if err != nil || vid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	period := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("period")))
	if period == "" {
		period = "30d"
	}
	var since time.Time
	switch period {
	case "7d":
		since = time.Now().Add(-7 * 24 * time.Hour)
	case "30d":
		since = time.Now().Add(-30 * 24 * time.Hour)
	case "90d":
		since = time.Now().Add(-90 * 24 * time.Hour)
	case "all":
		since = time.Time{}
	default:
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "period must be 7d|30d|90d|all")
		return
	}
	ctx := r.Context()
	var totalGrants, grantVol, activeInst, completed, forfeited, cost int64
	var grants24h int64
	q := `
		SELECT
			COUNT(*) FILTER (WHERE created_at >= $2)::bigint,
			COALESCE(SUM(granted_amount_minor) FILTER (WHERE created_at >= $2), 0)::bigint,
			COUNT(*) FILTER (WHERE status = 'active')::bigint,
			COUNT(*) FILTER (WHERE status = 'completed')::bigint,
			COUNT(*) FILTER (WHERE status = 'forfeited')::bigint,
			COALESCE(SUM(granted_amount_minor) FILTER (WHERE created_at >= $2), 0)::bigint,
			COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::bigint
		FROM user_bonus_instances WHERE promotion_version_id = $1
	`
	var err2 error
	if since.IsZero() {
		err2 = h.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*)::bigint,
				COALESCE(SUM(granted_amount_minor), 0)::bigint,
				COUNT(*) FILTER (WHERE status = 'active')::bigint,
				COUNT(*) FILTER (WHERE status = 'completed')::bigint,
				COUNT(*) FILTER (WHERE status = 'forfeited')::bigint,
				COALESCE(SUM(granted_amount_minor), 0)::bigint,
				COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::bigint
			FROM user_bonus_instances WHERE promotion_version_id = $1
		`, vid).Scan(&totalGrants, &grantVol, &activeInst, &completed, &forfeited, &cost, &grants24h)
	} else {
		err2 = h.Pool.QueryRow(ctx, q, vid, since).Scan(&totalGrants, &grantVol, &activeInst, &completed, &forfeited, &cost, &grants24h)
	}
	if err2 != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	nonPending := completed + forfeited + activeInst
	wrRate, forfRate := 0.0, 0.0
	if nonPending > 0 {
		wrRate = float64(completed) / float64(nonPending) * 100
		forfRate = float64(forfeited) / float64(nonPending) * 100
	}
	var denied, manual int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE decision = 'denied'),
			COUNT(*) FILTER (WHERE decision = 'manual_review')
		FROM bonus_risk_decisions WHERE promotion_version_id = $1
	`, vid).Scan(&denied, &manual)

	writeJSON(w, map[string]any{
		"promotion_version_id": vid,
		"period":               period,
		"total_grants":         totalGrants,
		"grants_last_24h":      grants24h,
		"grant_volume_minor":   grantVol,
		"active_instances":     activeInst,
		"completed_wr":         completed,
		"forfeited":            forfeited,
		"wr_completion_rate":   wrRate,
		"forfeiture_rate":      forfRate,
		"total_cost_minor":     cost,
		"risk_denied":          denied,
		"risk_manual_review":   manual,
	})
}

type patchVersionReq struct {
	PlayerTitle        *string          `json:"player_title"`
	PlayerDescription  *string          `json:"player_description"`
	PlayerHeroImageURL *string          `json:"player_hero_image_url"`
	InternalTitle      *string          `json:"internal_title"`
	Priority           *int             `json:"priority"`
	DedupeGroupKey     *string          `json:"dedupe_group_key"`
	ValidFrom          *string          `json:"valid_from"`
	ValidTo            *string          `json:"valid_to"`
	Rules              *json.RawMessage `json:"rules"`
	TermsText          *string          `json:"terms_text"`
}

func (h *Handler) bonusHubPatchPromotionVersion(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	vid, err := strconv.ParseInt(chi.URLParam(r, "vid"), 10, 64)
	if err != nil || vid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	var body patchVersionReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	ctx := r.Context()
	var versionPublishedAt *time.Time
	if err := h.Pool.QueryRow(ctx, `SELECT published_at FROM promotion_versions WHERE id = $1`, vid).Scan(&versionPublishedAt); err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "version not found")
		return
	}
	if body.Rules != nil && len(*body.Rules) > 0 && versionPublishedAt != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "not_editable", "cannot change rules on a published version")
		return
	}
	if body.TermsText != nil && versionPublishedAt != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "not_editable", "cannot change terms on a published version")
		return
	}
	if body.PlayerTitle != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET player_title = $2 WHERE id = $1`, vid, *body.PlayerTitle)
	}
	if body.PlayerDescription != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET player_description = $2 WHERE id = $1`, vid, *body.PlayerDescription)
	}
	if body.PlayerHeroImageURL != nil {
		u := strings.TrimSpace(*body.PlayerHeroImageURL)
		if u == "" {
			_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET player_hero_image_url = NULL WHERE id = $1`, vid)
		} else {
			_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET player_hero_image_url = $2 WHERE id = $1`, vid, u)
		}
	}
	if body.InternalTitle != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET internal_title = $2 WHERE id = $1`, vid, *body.InternalTitle)
	}
	if body.Priority != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET priority = $2 WHERE id = $1`, vid, *body.Priority)
	}
	if body.DedupeGroupKey != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET dedupe_group_key = NULLIF(TRIM($2),'') WHERE id = $1`, vid, *body.DedupeGroupKey)
	}
	if body.ValidFrom != nil {
		if strings.TrimSpace(*body.ValidFrom) == "" {
			_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET valid_from = NULL WHERE id = $1`, vid)
		} else if t, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.ValidFrom)); err == nil {
			_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET valid_from = $2 WHERE id = $1`, vid, t)
		}
	}
	if body.ValidTo != nil {
		if strings.TrimSpace(*body.ValidTo) == "" {
			_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET valid_to = NULL WHERE id = $1`, vid)
		} else if t, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.ValidTo)); err == nil {
			_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET valid_to = $2 WHERE id = $1`, vid, t)
		}
	}
	if body.Rules != nil && len(*body.Rules) > 0 {
		_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET rules = $2::jsonb WHERE id = $1`, vid, *body.Rules)
	}
	if body.TermsText != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE promotion_versions SET terms_text = NULLIF(TRIM($2),'') WHERE id = $1`, vid, *body.TermsText)
	}
	meta, _ := json.Marshal(map[string]any{"promotion_version_id": vid})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'bonushub.patch_version', 'promotion_versions', $2, $3::jsonb)
	`, staffID, strconv.FormatInt(vid, 10), meta)
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) bonusHubClonePromotionVersion(w http.ResponseWriter, r *http.Request) {
	vid, err := strconv.ParseInt(chi.URLParam(r, "vid"), 10, 64)
	if err != nil || vid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	ctx := r.Context()
	var newID int64
	var newVer int
	err = h.Pool.QueryRow(ctx, `
		WITH src AS (
			SELECT promotion_id, rules, terms_text, bonus_type,
				player_title, player_description, player_hero_image_url, promo_code, priority,
				valid_from, valid_to, internal_title, dedupe_group_key, offer_family, eligibility_fingerprint,
				weekly_schedule, timezone
			FROM promotion_versions WHERE id = $1
		), nver AS (
			SELECT COALESCE(MAX(pv.version),0)+1 AS v FROM promotion_versions pv WHERE pv.promotion_id = (SELECT promotion_id FROM src)
		)
		INSERT INTO promotion_versions (
			promotion_id, version, rules, terms_text, published_at, bonus_type,
			player_title, player_description, player_hero_image_url, promo_code, priority,
			valid_from, valid_to, internal_title, dedupe_group_key, offer_family, eligibility_fingerprint,
			weekly_schedule, timezone
		)
		SELECT s.promotion_id, n.v, s.rules, s.terms_text, NULL, s.bonus_type,
			s.player_title, s.player_description, s.player_hero_image_url, s.promo_code, s.priority,
			s.valid_from, s.valid_to, s.internal_title, s.dedupe_group_key, s.offer_family, s.eligibility_fingerprint,
			s.weekly_schedule, s.timezone
		FROM src s, nver n
		RETURNING id, version
	`, vid).Scan(&newID, &newVer)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	writeJSON(w, map[string]any{"promotion_version_id": newID, "version": newVer})
}

func (h *Handler) bonusHubPromotionsCalendar(w http.ResponseWriter, r *http.Request) {
	fromS := strings.TrimSpace(r.URL.Query().Get("from"))
	toS := strings.TrimSpace(r.URL.Query().Get("to"))
	if fromS == "" || toS == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "from and to (RFC3339) required")
		return
	}
	from, e1 := time.Parse(time.RFC3339, fromS)
	to, e2 := time.Parse(time.RFC3339, toS)
	if e1 != nil || e2 != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid date range")
		return
	}
	ctx := r.Context()
	rows, err := h.Pool.Query(ctx, `
		SELECT pv.id, p.id, p.name, pv.valid_from, pv.valid_to, pv.published_at, p.admin_color, pv.bonus_type
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE p.status != 'archived'
		  AND COALESCE(p.grants_paused, false) = false
		  AND pv.published_at IS NOT NULL
		  AND (pv.valid_to IS NULL OR pv.valid_to >= $1)
		  AND (pv.valid_from IS NULL OR pv.valid_from <= $2)
		ORDER BY pv.valid_from NULLS FIRST
	`, from, to)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var evs []map[string]any
	for rows.Next() {
		var vid, pid int64
		var name string
		var vf, vt, pub *time.Time
		var adminColor, bonusType *string
		if err := rows.Scan(&vid, &pid, &name, &vf, &vt, &pub, &adminColor, &bonusType); err != nil {
			continue
		}
		item := map[string]any{
			"promotion_version_id": vid, "promotion_id": pid, "name": name,
			"valid_from": nullRFC3339(vf), "valid_to": nullRFC3339(vt),
			"published_at": nullRFC3339(pub),
		}
		if adminColor != nil && strings.TrimSpace(*adminColor) != "" {
			item["admin_color"] = strings.ToUpper(strings.TrimSpace(*adminColor))
		}
		if bonusType != nil && strings.TrimSpace(*bonusType) != "" {
			item["bonus_type"] = strings.TrimSpace(*bonusType)
		}
		evs = append(evs, item)
	}
	writeJSON(w, map[string]any{"events": evs})
}

type targetsBody struct {
	UserIDs []string `json:"user_ids"`
}

func (h *Handler) bonusHubPostTargets(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	vid, err := strconv.ParseInt(chi.URLParam(r, "vid"), 10, 64)
	if err != nil || vid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	var body targetsBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	pol := bonus.LoadAbusePolicy(r.Context(), h.Pool)
	if len(body.UserIDs) > pol.MaxCSVTargetsPerUpload {
		adminapi.WriteError(w, http.StatusBadRequest, "too_many_targets", "batch exceeds policy limit")
		return
	}
	ctx := r.Context()
	var n int
	for _, s := range body.UserIDs {
		id, err := uuid.Parse(strings.TrimSpace(s))
		if err != nil {
			continue
		}
		tag, err := h.Pool.Exec(ctx, `
			INSERT INTO promotion_targets (promotion_version_id, user_id) VALUES ($1, $2::uuid)
			ON CONFLICT DO NOTHING
		`, vid, id.String())
		if err == nil {
			n += int(tag.RowsAffected())
		}
	}
	meta, _ := json.Marshal(map[string]any{"promotion_version_id": vid, "inserted": n})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'bonushub.add_targets', 'promotion_targets', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true, "inserted": n})
}

func (h *Handler) bonusHubGetTargets(w http.ResponseWriter, r *http.Request) {
	vid, err := strconv.ParseInt(chi.URLParam(r, "vid"), 10, 64)
	if err != nil || vid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	limit := 100
	if s := strings.TrimSpace(r.URL.Query().Get("limit")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 0 {
			limit = n
		}
	}
	if limit > 500 {
		limit = 500
	}
	offset := 0
	if s := strings.TrimSpace(r.URL.Query().Get("offset")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 0 {
			offset = n
		}
	}
	ctx := r.Context()
	var total int64
	if err := h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM promotion_targets WHERE promotion_version_id = $1
	`, vid).Scan(&total); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "count failed")
		return
	}
	rows, err := h.Pool.Query(ctx, `
		SELECT user_id::text FROM promotion_targets
		WHERE promotion_version_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, vid, limit, offset)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			continue
		}
		ids = append(ids, u)
	}
	writeJSON(w, map[string]any{
		"promotion_version_id": vid,
		"total":                total,
		"user_ids":             ids,
		"limit":                limit,
		"offset":               offset,
	})
}
