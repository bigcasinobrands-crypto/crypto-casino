package adminops

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/bonus/bonustypes"
	"github.com/crypto-casino/core/internal/bonusblueocean"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (h *Handler) mountBonusHub(r chi.Router) {
	r.Route("/bonushub", func(b chi.Router) {
		b.Get("/dashboard/summary", h.bonusHubDashboard)
		b.Get("/recommendations", h.bonusHubRecommendations)
		b.Get("/bonus-types", h.bonusHubListBonusTypes)
		b.Get("/promotions", h.bonusHubListPromotions)
		b.Post("/promotions", h.bonusHubCreatePromotion)
		b.Get("/promotions/{id}", h.bonusHubGetPromotion)
		// grants_paused: admin/support/superadmin; status (archive): superadmin only (enforced in handler).
		b.Patch("/promotions/{id}", h.bonusHubPatchPromotion)
		b.Post("/promotions/{id}/versions", h.bonusHubAddVersion)
		b.Post("/promotion-versions/{vid}/publish", h.bonusHubPublishVersion)
		b.Get("/reward-programs", h.bonusHubListRewardPrograms)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/reward-programs", h.bonusHubCreateRewardProgram)
		b.Get("/automation-rules", h.bonusHubListAutomationRules)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/automation-rules", h.bonusHubCreateAutomationRule)
		b.With(adminapi.RequireAnyRole("superadmin")).Patch("/automation-rules/{id}", h.bonusHubPatchAutomationRule)
		b.Get("/worker-failed-jobs", h.bonusHubListWorkerFailedJobs)
		b.Get("/bonus-audit-log", h.bonusHubBonusAuditLog)
		b.Get("/bonus-outbox", h.bonusHubBonusOutbox)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/bonus-outbox/{id}/redrive", h.bonusHubRedriveBonusOutbox)
		b.Get("/wager-violations", h.bonusHubWagerViolations)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/simulate-payment-settled", h.bonusHubSimulatePaymentSettled)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/worker-failed-jobs/{id}/retry", h.bonusHubRetryWorkerFailedJob)
		b.Get("/risk-queue", h.bonusHubRiskQueue)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/risk-queue/{id}/resolve", h.bonusHubResolveRiskReview)
		b.Get("/offers/active", h.bonusHubActiveOffers)
		b.Get("/promotion-versions/{vid}/performance", h.bonusHubVersionPerformance)
		b.Get("/promotions/calendar", h.bonusHubPromotionsCalendar)
		b.Get("/campaign-daily-stats", h.bonusHubCampaignDailyStats)
		b.With(adminapi.RequireAnyRole("superadmin")).Patch("/promotion-versions/{vid}", h.bonusHubPatchPromotionVersion)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/promotion-versions/{vid}/clone", h.bonusHubClonePromotionVersion)
		b.Get("/promotion-versions/{vid}/targets", h.bonusHubGetTargets)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/promotion-versions/{vid}/targets", h.bonusHubPostTargets)
		b.Get("/instances", h.bonusHubListInstances)
		b.With(adminapi.RequireAnyRole("admin", "superadmin")).Post("/instances/{id}/forfeit", h.bonusHubForfeitInstance)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/instances/grant", h.bonusHubManualGrant)
		b.Get("/free-spin-grants", h.bonusHubListFreeSpinGrants)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/free-spin-grants", h.bonusHubCreateFreeSpinGrant)
	})
	r.Get("/users/{id}/economic-timeline", h.userEconomicTimeline)
}

func (h *Handler) bonusHubDashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if h.dashboardDisplaySuppressed(ctx) {
		writeJSON(w, zeroBonusHubDashboardMap())
		return
	}
	var promos, instActive, grants24 int64
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM promotions WHERE status != 'archived'`).Scan(&promos)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status = 'active'`).Scan(&instActive)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances
		WHERE created_at > now() - interval '24 hours'
		  AND status IN ('active', 'completed', 'expired', 'forfeited')
	`).Scan(&grants24)
	riskPending := bonus.ReviewQueuePending(ctx, h.Pool)

	// Bonus cost: derive from the SAME promo.grant + bonus_locked ledger entries
	// that feed the headline bonus_cost_* KPI on the main dashboard. Reading from
	// user_bonus_instances would silently disagree if a row was inserted but the
	// ledger credit failed (or vice versa). Ledger is the single source of truth.
	var bonusCost30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
		WHERE entry_type = 'promo.grant' AND pocket = 'bonus_locked' AND amount_minor > 0
		  AND created_at > now() - interval '30 days'
	`).Scan(&bonusCost30d)

	// Bonus instance turnover: voluntary forfeits (player/admin) AND TTL
	// expirations both retire an instance without converting to cash. The
	// `forfeiture_rate` headline metric covers BOTH so it accurately reflects
	// how much granted bonus value never made it through wagering. The
	// breakdown counts are exposed alongside so the admin UI can split them.
	var totalCompleted, totalForfeited, totalExpired, totalNonPending int64
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status = 'completed'`).Scan(&totalCompleted)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status = 'forfeited'`).Scan(&totalForfeited)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status = 'expired'`).Scan(&totalExpired)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status NOT IN ('pending','pending_review')`).Scan(&totalNonPending)

	var wrCompletionRate, forfeitureRate, expirationRate float64
	if totalNonPending > 0 {
		wrCompletionRate = float64(totalCompleted) / float64(totalNonPending) * 100
		forfeitureRate = float64(totalForfeited+totalExpired) / float64(totalNonPending) * 100
		expirationRate = float64(totalExpired) / float64(totalNonPending) * 100
	}

	var avgGrantMinor int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(granted_amount_minor), 0)::bigint FROM user_bonus_instances
		WHERE status IN ('active', 'completed', 'expired', 'forfeited')
	`).Scan(&avgGrantMinor)

	// GGR includes both casino and sportsbook activity for the bonus-as-percent-of-GGR ratio.
	var ggr30d int64
	ngrF := ledger.NGRReportingFilterSQL("le")
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(
			SUM(CASE WHEN le.entry_type IN ('game.debit','game.bet','sportsbook.debit') THEN ABS(le.amount_minor) WHEN le.entry_type IN ('game.rollback','sportsbook.rollback') THEN -ABS(le.amount_minor) ELSE 0 END) -
			SUM(CASE WHEN le.entry_type IN ('game.credit','game.win','game.win_rollback','sportsbook.credit') THEN le.amount_minor ELSE 0 END), 0
		)::bigint FROM ledger_entries le
		WHERE le.entry_type IN ('game.debit','game.bet','game.credit','game.win','game.rollback','game.win_rollback','sportsbook.debit','sportsbook.credit','sportsbook.rollback')
		  AND le.created_at > now() - interval '30 days' AND `+ngrF+`
	`).Scan(&ggr30d)

	var bonusPctOfGGR float64
	if ggr30d > 0 {
		bonusPctOfGGR = float64(bonusCost30d) / float64(ggr30d) * 100
	}

	writeJSON(w, map[string]any{
		"promotions_non_archived": promos,
		"active_bonus_instances":  instActive,
		"grants_last_24h":         grants24,
		"risk_queue_pending":      riskPending,
		"total_bonus_cost_30d":    bonusCost30d,
		"wr_completion_rate":      wrCompletionRate,
		"forfeiture_rate":         forfeitureRate, // includes voluntary forfeits + TTL expirations
		"expiration_rate":         expirationRate, // TTL-expired only (subset of forfeiture_rate)
		"total_forfeited":         totalForfeited,
		"total_expired":           totalExpired,
		"avg_grant_amount_minor":  avgGrantMinor,
		"bonus_pct_of_ggr":        bonusPctOfGGR,
	})
}

func (h *Handler) bonusHubListBonusTypes(w http.ResponseWriter, r *http.Request) {
	var out []map[string]any
	for _, e := range bonustypes.All() {
		out = append(out, map[string]any{
			"id": e.ID, "label": e.Label, "description": e.Description,
		})
	}
	writeJSON(w, map[string]any{"bonus_types": out})
}

func (h *Handler) bonusHubListPromotions(w http.ResponseWriter, r *http.Request) {
	forVIPScheduling := strings.TrimSpace(r.URL.Query().Get("for_vip_scheduling")) == "1"
	maxLimit := 200
	if forVIPScheduling {
		maxLimit = 500
	}
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= maxLimit {
			limit = n
		}
	}
	var afterID *int64
	if v := strings.TrimSpace(r.URL.Query().Get("after_id")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			afterID = &n
		}
	}
	statusQ := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
	if statusQ != "" && statusQ != "all" && statusQ != "draft" && statusQ != "archived" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "status must be draft, archived, or all")
		return
	}
	qStr := strings.TrimSpace(r.URL.Query().Get("q"))

	var sb strings.Builder
	sb.WriteString(`
		SELECT p.id, p.name, p.slug, p.status, p.created_at, COALESCE(p.grants_paused, false),
			COALESCE(p.player_hub_force_visible, false),
			COALESCE(p.vip_only, false),
			p.admin_color,
			(SELECT MAX(version) FROM promotion_versions pv WHERE pv.promotion_id = p.id) AS max_ver,
			(SELECT pv2.bonus_type FROM promotion_versions pv2 WHERE pv2.promotion_id = p.id ORDER BY pv2.version DESC LIMIT 1) AS bonus_type,
			(SELECT pv3.id FROM promotion_versions pv3 WHERE pv3.promotion_id = p.id ORDER BY pv3.version DESC LIMIT 1) AS latest_version_id,
			(SELECT (pv4.published_at IS NOT NULL) FROM promotion_versions pv4 WHERE pv4.promotion_id = p.id ORDER BY pv4.version DESC LIMIT 1) AS latest_version_published,
			(SELECT pv6.valid_from FROM promotion_versions pv6 WHERE pv6.promotion_id = p.id AND pv6.published_at IS NOT NULL ORDER BY pv6.version DESC LIMIT 1) AS latest_published_valid_from,
			(SELECT pv6.valid_to FROM promotion_versions pv6 WHERE pv6.promotion_id = p.id AND pv6.published_at IS NOT NULL ORDER BY pv6.version DESC LIMIT 1) AS latest_published_valid_to,
			EXISTS (
				SELECT 1 FROM promotion_versions pv5
				WHERE pv5.promotion_id = p.id AND pv5.published_at IS NOT NULL
			) AS has_published_version
		FROM promotions p WHERE 1=1`)
	args := []interface{}{}
	n := 1
	if statusQ == "draft" || statusQ == "archived" {
		sb.WriteString(fmt.Sprintf(" AND p.status = $%d", n))
		args = append(args, statusQ)
		n++
	}
	if qStr != "" {
		sb.WriteString(fmt.Sprintf(" AND (p.name ILIKE $%d OR p.slug ILIKE $%d)", n, n+1))
		like := "%" + qStr + "%"
		args = append(args, like, like)
		n += 2
	}
	if forVIPScheduling {
		// Promotions operators use for tier VIP delivery: explicit flag, VIP-ish bonus type, or name/slug cue.
		sb.WriteString(`
			AND (
				COALESCE(p.vip_only, false) = true
				OR LOWER(TRIM(COALESCE((
					SELECT pv_vip.bonus_type FROM promotion_versions pv_vip
					WHERE pv_vip.promotion_id = p.id ORDER BY pv_vip.version DESC LIMIT 1
				), ''))) LIKE 'vip%'
				OR p.name ILIKE '%vip%'
				OR p.slug ILIKE '%vip%'
			)`)
	}
	if afterID != nil {
		sb.WriteString(fmt.Sprintf(" AND p.id < $%d", n))
		args = append(args, *afterID)
		n++
	}
	sb.WriteString(fmt.Sprintf(" ORDER BY p.id DESC LIMIT $%d", n))
	args = append(args, limit)

	ctx := r.Context()
	rows, err := h.Pool.Query(ctx, sb.String(), args...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, maxVer int64
		var name, slug, status string
		var ct time.Time
		var grantsPaused bool
		var hubForce bool
		var bonusType, adminColor *string
		var vipOnly bool
		var latestVID sql.NullInt64
		var latestPub sql.NullBool
		var latestPublishedValidFrom sql.NullTime
		var latestPublishedValidTo sql.NullTime
		var hasPub sql.NullBool
		if err := rows.Scan(&id, &name, &slug, &status, &ct, &grantsPaused, &hubForce, &vipOnly, &adminColor, &maxVer, &bonusType,
			&latestVID, &latestPub, &latestPublishedValidFrom, &latestPublishedValidTo, &hasPub); err != nil {
			continue
		}
		entry := map[string]any{
			"id": id, "name": name, "slug": slug, "status": status,
			"created_at": ct.UTC().Format(time.RFC3339), "latest_version": maxVer,
			"grants_paused": grantsPaused, "player_hub_force_visible": hubForce,
			"vip_only": vipOnly,
		}
		if bonusType != nil && *bonusType != "" {
			entry["bonus_type"] = *bonusType
		}
		if adminColor != nil && *adminColor != "" {
			entry["admin_color"] = strings.ToUpper(*adminColor)
		}
		if latestVID.Valid {
			entry["latest_version_id"] = latestVID.Int64
		}
		entry["latest_version_published"] = latestPub.Valid && latestPub.Bool
		entry["has_published_version"] = hasPub.Valid && hasPub.Bool
		if latestPublishedValidFrom.Valid {
			entry["latest_published_valid_from"] = latestPublishedValidFrom.Time.UTC().Format(time.RFC3339)
		}
		if latestPublishedValidTo.Valid {
			entry["latest_published_valid_to"] = latestPublishedValidTo.Time.UTC().Format(time.RFC3339)
		}
		list = append(list, entry)
	}
	var nextCursor any
	if len(list) > 0 {
		if last, ok := list[len(list)-1]["id"].(int64); ok {
			nextCursor = last
		}
	}
	writeJSON(w, map[string]any{"promotions": list, "next_after_id": nextCursor})
}

type createPromoReq struct {
	Name       string  `json:"name"`
	Slug       string  `json:"slug"`
	AdminColor *string `json:"admin_color"`
	VIPOnly    bool    `json:"vip_only"`
}

func (h *Handler) bonusHubCreatePromotion(w http.ResponseWriter, r *http.Request) {
	var body createPromoReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Slug) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "name and slug required")
		return
	}
	adminColor, colorErr := normalizeAdminColor(body.AdminColor)
	if colorErr != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", colorErr.Error())
		return
	}
	var id int64
	err := h.Pool.QueryRow(r.Context(), `
		INSERT INTO promotions (name, slug, admin_color, vip_only) VALUES ($1, $2, $3, $4) RETURNING id
	`, strings.TrimSpace(body.Name), strings.TrimSpace(body.Slug), adminColor, body.VIPOnly).Scan(&id)
	if err != nil {
		if isPGUniqueViolation(err) {
			adminapi.WriteError(w, http.StatusConflict, "slug_taken",
				"A promotion with this URL slug already exists. Change the slug (or name) and try again.")
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	writeJSON(w, map[string]any{"id": id})
}

func (h *Handler) bonusHubGetPromotion(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	var name, slug, status string
	var adminColor *string
	var ct time.Time
	var grantsPaused bool
	var hubForce bool
	var vipOnly bool
	err = h.Pool.QueryRow(r.Context(), `
		SELECT name, slug, status, created_at, COALESCE(grants_paused, false), COALESCE(player_hub_force_visible, false), COALESCE(vip_only, false), admin_color
		FROM promotions WHERE id = $1
	`, id).Scan(&name, &slug, &status, &ct, &grantsPaused, &hubForce, &vipOnly, &adminColor)
	if err == pgx.ErrNoRows {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "promotion not found")
		return
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, version, published_at IS NOT NULL, created_at, valid_from, valid_to,
			rules, COALESCE(terms_text,''), bonus_type,
			NULLIF(TRIM(COALESCE(player_title,'')), ''),
			NULLIF(TRIM(COALESCE(player_description,'')), ''),
			NULLIF(TRIM(COALESCE(promo_code,'')), ''),
			priority,
			NULLIF(TRIM(COALESCE(player_hero_image_url,'')), '')
		FROM promotion_versions WHERE promotion_id = $1 ORDER BY version DESC
	`, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "versions failed")
		return
	}
	defer rows.Close()
	var vers []map[string]any
	for rows.Next() {
		var vid, ver int64
		var pub bool
		var vct time.Time
		var vf, vt *time.Time
		var rulesJSON []byte
		var terms string
		var bonusType *string
		var pTitle, pDesc, pCode, pHero *string
		var pri int
		if err := rows.Scan(&vid, &ver, &pub, &vct, &vf, &vt, &rulesJSON, &terms, &bonusType,
			&pTitle, &pDesc, &pCode, &pri, &pHero); err != nil {
			continue
		}
		entry := map[string]any{
			"id": vid, "version": ver, "published": pub, "created_at": vct.UTC().Format(time.RFC3339),
			"priority": pri,
		}
		if vf != nil {
			entry["valid_from"] = vf.UTC().Format(time.RFC3339)
		}
		if vt != nil {
			entry["valid_to"] = vt.UTC().Format(time.RFC3339)
		}
		if len(rulesJSON) > 0 {
			var rm map[string]any
			if json.Unmarshal(rulesJSON, &rm) == nil {
				entry["rules"] = rm
			}
		}
		entry["terms_text"] = terms
		if bonusType != nil && *bonusType != "" {
			entry["bonus_type"] = *bonusType
		}
		if pTitle != nil {
			entry["player_title"] = *pTitle
		}
		if pDesc != nil {
			entry["player_description"] = *pDesc
		}
		if pCode != nil {
			entry["promo_code"] = *pCode
		}
		if pHero != nil {
			entry["player_hero_image_url"] = *pHero
		}
		vers = append(vers, entry)
	}
	writeJSON(w, map[string]any{
		"id": id, "name": name, "slug": slug, "status": status,
		"created_at": ct.UTC().Format(time.RFC3339), "versions": vers,
		"grants_paused": grantsPaused, "player_hub_force_visible": hubForce,
		"vip_only": vipOnly,
		"admin_color": func() any {
			if adminColor == nil || *adminColor == "" {
				return nil
			}
			return strings.ToUpper(*adminColor)
		}(),
	})
}

type patchPromoReq struct {
	GrantsPaused          *bool   `json:"grants_paused"`
	Status                *string `json:"status"`
	PlayerHubForceVisible *bool   `json:"player_hub_force_visible"`
	AdminColor            *string `json:"admin_color"`
	VIPOnly               *bool   `json:"vip_only"`
}

func (h *Handler) bonusHubPatchPromotion(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	role, _ := adminapi.StaffRoleFromContext(r.Context())
	isSuper := role == "superadmin"
	canPauseGrants := role == "superadmin" || role == "admin" || role == "support"
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	var body patchPromoReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if body.GrantsPaused == nil && body.Status == nil && body.PlayerHubForceVisible == nil && body.AdminColor == nil && body.VIPOnly == nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "at least one of grants_paused, status, player_hub_force_visible, admin_color, vip_only required")
		return
	}
	if body.Status != nil && !isSuper {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "only superadmin can archive or restore promotions")
		return
	}
	if body.GrantsPaused != nil && !canPauseGrants {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "not allowed to change grants_paused")
		return
	}
	if body.PlayerHubForceVisible != nil && !canPauseGrants {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "not allowed to change player_hub_force_visible")
		return
	}
	if body.AdminColor != nil && !canPauseGrants {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "not allowed to change admin_color")
		return
	}
	if body.VIPOnly != nil && !canPauseGrants {
		adminapi.WriteError(w, http.StatusForbidden, "forbidden", "not allowed to change vip_only")
		return
	}
	adminColor, colorErr := normalizeAdminColor(body.AdminColor)
	if colorErr != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", colorErr.Error())
		return
	}
	var newStatus string
	if body.Status != nil {
		newStatus = strings.ToLower(strings.TrimSpace(*body.Status))
		if newStatus != "draft" && newStatus != "archived" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "status must be draft or archived")
			return
		}
	}
	ctx := r.Context()

	var setParts []string
	var args []interface{}
	argPos := 1
	if body.Status != nil {
		setParts = append(setParts, fmt.Sprintf("status = $%d", argPos))
		args = append(args, newStatus)
		argPos++
		if newStatus == "archived" {
			setParts = append(setParts, "player_hub_force_visible = false")
		}
	}
	if body.GrantsPaused != nil {
		setParts = append(setParts, fmt.Sprintf("grants_paused = $%d", argPos))
		args = append(args, *body.GrantsPaused)
		argPos++
		if *body.GrantsPaused {
			setParts = append(setParts, "player_hub_force_visible = false")
		}
	}
	skipForceArg := (body.Status != nil && newStatus == "archived") || (body.GrantsPaused != nil && *body.GrantsPaused)
	if body.PlayerHubForceVisible != nil && !skipForceArg {
		setParts = append(setParts, fmt.Sprintf("player_hub_force_visible = $%d", argPos))
		args = append(args, *body.PlayerHubForceVisible)
		argPos++
	}
	if body.AdminColor != nil {
		setParts = append(setParts, fmt.Sprintf("admin_color = $%d", argPos))
		args = append(args, adminColor)
		argPos++
	}
	if body.VIPOnly != nil {
		setParts = append(setParts, fmt.Sprintf("vip_only = $%d", argPos))
		args = append(args, *body.VIPOnly)
		argPos++
	}
	if len(setParts) == 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "no fields to update")
		return
	}
	setParts = append(setParts, "updated_at = now()")
	args = append(args, id)
	q := fmt.Sprintf("UPDATE promotions SET %s WHERE id = $%d", strings.Join(setParts, ", "), argPos)
	res, execErr := h.Pool.Exec(ctx, q, args...)
	if execErr != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if res.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "promotion not found")
		return
	}
	meta := map[string]any{"promotion_id": id}
	if body.GrantsPaused != nil {
		meta["grants_paused"] = *body.GrantsPaused
	}
	if body.Status != nil {
		meta["status"] = newStatus
	}
	if body.PlayerHubForceVisible != nil {
		meta["player_hub_force_visible"] = *body.PlayerHubForceVisible
	}
	if body.AdminColor != nil {
		meta["admin_color"] = adminColor
	}
	if body.VIPOnly != nil {
		meta["vip_only"] = *body.VIPOnly
	}
	metaB, _ := json.Marshal(meta)
	h.auditExec(r.Context(), "bonushub.patch_promotion", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'bonushub.patch_promotion', 'promotions', $2, $3::jsonb)
	`, staffID, strconv.FormatInt(id, 10), metaB)
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) bonusHubListAutomationRules(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, name, enabled, priority, trigger_type, schedule_cron, segment_filter, action, created_at, updated_at
		FROM bonus_automation_rules ORDER BY priority DESC, id ASC LIMIT 200
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var name, trig string
		var en bool
		var pri int
		var sched *string
		var seg, act []byte
		var ct, ut time.Time
		if err := rows.Scan(&id, &name, &en, &pri, &trig, &sched, &seg, &act, &ct, &ut); err != nil {
			continue
		}
		var segM, actM map[string]any
		_ = json.Unmarshal(seg, &segM)
		_ = json.Unmarshal(act, &actM)
		if segM == nil {
			segM = map[string]any{}
		}
		if actM == nil {
			actM = map[string]any{}
		}
		entry := map[string]any{
			"id": id, "name": name, "enabled": en, "priority": pri, "trigger_type": trig,
			"segment_filter": segM, "action": actM,
			"created_at": ct.UTC().Format(time.RFC3339), "updated_at": ut.UTC().Format(time.RFC3339),
		}
		if sched != nil {
			entry["schedule_cron"] = *sched
		}
		list = append(list, entry)
	}
	writeJSON(w, map[string]any{"rules": list})
}

type createAutomationRuleReq struct {
	Name          string          `json:"name"`
	Enabled       *bool           `json:"enabled"`
	Priority      int             `json:"priority"`
	TriggerType   string          `json:"trigger_type"`
	ScheduleCron  *string         `json:"schedule_cron"`
	SegmentFilter json.RawMessage `json:"segment_filter"`
	Action        json.RawMessage `json:"action"`
}

func (h *Handler) bonusHubCreateAutomationRule(w http.ResponseWriter, r *http.Request) {
	var body createAutomationRuleReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.TriggerType) == "" || len(body.Action) == 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "name, trigger_type, action required")
		return
	}
	en := true
	if body.Enabled != nil {
		en = *body.Enabled
	}
	seg := body.SegmentFilter
	if len(seg) == 0 {
		seg = json.RawMessage(`{}`)
	}
	ctx := r.Context()
	var id int64
	err := h.Pool.QueryRow(ctx, `
		INSERT INTO bonus_automation_rules (name, enabled, priority, trigger_type, schedule_cron, segment_filter, action)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id
	`, strings.TrimSpace(body.Name), en, body.Priority, strings.TrimSpace(body.TriggerType), body.ScheduleCron, seg, body.Action).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	writeJSON(w, map[string]any{"id": id})
}

type patchAutomationRuleReq struct {
	Name          *string          `json:"name"`
	Enabled       *bool            `json:"enabled"`
	Priority      *int             `json:"priority"`
	TriggerType   *string          `json:"trigger_type"`
	ScheduleCron  *string          `json:"schedule_cron"`
	SegmentFilter *json.RawMessage `json:"segment_filter"`
	Action        *json.RawMessage `json:"action"`
}

func (h *Handler) bonusHubPatchAutomationRule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	var body patchAutomationRuleReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "json required")
		return
	}
	ctx := r.Context()
	if body.Name != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE bonus_automation_rules SET name = $2, updated_at = now() WHERE id = $1`, id, strings.TrimSpace(*body.Name))
	}
	if body.Enabled != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE bonus_automation_rules SET enabled = $2, updated_at = now() WHERE id = $1`, id, *body.Enabled)
	}
	if body.Priority != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE bonus_automation_rules SET priority = $2, updated_at = now() WHERE id = $1`, id, *body.Priority)
	}
	if body.TriggerType != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE bonus_automation_rules SET trigger_type = $2, updated_at = now() WHERE id = $1`, id, strings.TrimSpace(*body.TriggerType))
	}
	if body.ScheduleCron != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE bonus_automation_rules SET schedule_cron = $2, updated_at = now() WHERE id = $1`, id, body.ScheduleCron)
	}
	if body.SegmentFilter != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE bonus_automation_rules SET segment_filter = $2::jsonb, updated_at = now() WHERE id = $1`, id, *body.SegmentFilter)
	}
	if body.Action != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE bonus_automation_rules SET action = $2::jsonb, updated_at = now() WHERE id = $1`, id, *body.Action)
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) bonusHubListWorkerFailedJobs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	jobType := strings.TrimSpace(r.URL.Query().Get("job_type"))
	var afterID *int64
	if v := strings.TrimSpace(r.URL.Query().Get("after_id")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			afterID = &n
		}
	}
	ctx := r.Context()
	var rows pgx.Rows
	var err error
	if jobType != "" && afterID != nil {
		rows, err = h.Pool.Query(ctx, `
			SELECT id, job_type, payload, error_text, attempts, created_at, resolved_at
			FROM worker_failed_jobs WHERE job_type = $1 AND id < $2::bigint ORDER BY id DESC LIMIT $3
		`, jobType, *afterID, limit)
	} else if jobType != "" {
		rows, err = h.Pool.Query(ctx, `
			SELECT id, job_type, payload, error_text, attempts, created_at, resolved_at
			FROM worker_failed_jobs WHERE job_type = $1 ORDER BY id DESC LIMIT $2
		`, jobType, limit)
	} else if afterID != nil {
		rows, err = h.Pool.Query(ctx, `
			SELECT id, job_type, payload, error_text, attempts, created_at, resolved_at
			FROM worker_failed_jobs WHERE id < $1::bigint ORDER BY id DESC LIMIT $2
		`, *afterID, limit)
	} else {
		rows, err = h.Pool.Query(ctx, `
			SELECT id, job_type, payload, error_text, attempts, created_at, resolved_at
			FROM worker_failed_jobs ORDER BY id DESC LIMIT $1
		`, limit)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var jt, errTxt string
		var payload []byte
		var att int
		var ct time.Time
		var resolved *time.Time
		if err := rows.Scan(&id, &jt, &payload, &errTxt, &att, &ct, &resolved); err != nil {
			continue
		}
		var pay map[string]any
		_ = json.Unmarshal(payload, &pay)
		if pay == nil {
			pay = map[string]any{}
		}
		item := map[string]any{
			"id": id, "job_type": jt, "payload": pay, "error_text": errTxt, "attempts": att,
			"created_at": ct.UTC().Format(time.RFC3339),
		}
		if resolved != nil {
			item["resolved_at"] = resolved.UTC().Format(time.RFC3339)
		}
		list = append(list, item)
	}
	var nextAfter any
	if len(list) > 0 {
		if last, ok := list[len(list)-1]["id"].(int64); ok {
			nextAfter = last
		}
	}
	writeJSON(w, map[string]any{"failed_jobs": list, "next_after_id": nextAfter})
}

type addVersionReq struct {
	Rules              json.RawMessage `json:"rules"`
	TermsText          string          `json:"terms_text"`
	BonusType          *string         `json:"bonus_type"`
	PlayerHeroImageURL *string         `json:"player_hero_image_url"`
}

func (h *Handler) bonusHubAddVersion(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || pid <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	var body addVersionReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Rules) == 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "rules json required")
		return
	}
	var bt *string
	if body.BonusType != nil {
		s := strings.TrimSpace(*body.BonusType)
		if s != "" {
			if !bonustypes.Valid(s) {
				adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "unknown bonus_type")
				return
			}
			bt = &s
		}
	}
	ctx := r.Context()
	var next int
	_ = h.Pool.QueryRow(ctx, `SELECT COALESCE(MAX(version),0)+1 FROM promotion_versions WHERE promotion_id = $1`, pid).Scan(&next)
	var hero any
	if body.PlayerHeroImageURL != nil {
		s := strings.TrimSpace(*body.PlayerHeroImageURL)
		if s != "" {
			hero = s
		}
	}
	var vid int64
	err = h.Pool.QueryRow(ctx, `
		INSERT INTO promotion_versions (promotion_id, version, rules, terms_text, bonus_type, player_hero_image_url)
		VALUES ($1, $2, $3::jsonb, NULLIF($4,''), $5, $6) RETURNING id
	`, pid, next, body.Rules, strings.TrimSpace(body.TermsText), bt, hero).Scan(&vid)
	if err != nil {
		if isPGUniqueViolation(err) {
			adminapi.WriteError(w, http.StatusConflict, "version_exists",
				"This promotion version already exists. Refresh the page and try again.")
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "insert failed")
		return
	}
	writeJSON(w, map[string]any{"promotion_version_id": vid, "version": next})
}

func (h *Handler) bonusHubPublishVersion(w http.ResponseWriter, r *http.Request) {
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
	ctx := r.Context()
	var rulesJSON []byte
	var offerFam, dedupe *string
	var publishedAt *time.Time
	err = h.Pool.QueryRow(ctx, `
		SELECT rules, offer_family, dedupe_group_key, published_at
		FROM promotion_versions WHERE id = $1
	`, vid).Scan(&rulesJSON, &offerFam, &dedupe, &publishedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			adminapi.WriteError(w, http.StatusBadRequest, "version_not_found", "promotion version not found (check catalog refresh)")
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	// Idempotent: UI may think the version is still a draft (stale list, or grants paused vs publish confusion).
	if publishedAt != nil {
		writeJSON(w, map[string]any{"ok": true, "already_published": true})
		return
	}
	var fam string
	if offerFam != nil {
		fam = *offerFam
	}
	if fam == "" {
		var perr error
		fam, perr = bonus.DeriveOfferFamily(rulesJSON)
		if perr != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_rules", "cannot parse rules")
			return
		}
	}
	fp, ferr := bonus.EligibilityFingerprintHex(rulesJSON, fam)
	if ferr != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_rules", "fingerprint failed")
		return
	}
	if err := bonus.CheckExclusivePublishConflict(ctx, h.Pool, vid, rulesJSON, offerFam, dedupe); err != nil {
		var c *bonus.LivePublishConflictError
		if errors.As(err, &c) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":                "dedupe_conflict",
					"message":             err.Error(),
					"conflict_version_id": c.ConflictVersionID,
					"promotion_name":      c.PromotionName,
				},
			})
			return
		}
		adminapi.WriteError(w, http.StatusInternalServerError, "dedupe_check_failed", err.Error())
		return
	}
	tag, err := h.Pool.Exec(ctx, `
		UPDATE promotion_versions
		SET published_at = now(), offer_family = $2, eligibility_fingerprint = $3
		WHERE id = $1 AND published_at IS NULL
	`, vid, fam, fp)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		var nowPub *time.Time
		_ = h.Pool.QueryRow(ctx, `SELECT published_at FROM promotion_versions WHERE id = $1`, vid).Scan(&nowPub)
		if nowPub != nil {
			writeJSON(w, map[string]any{"ok": true, "already_published": true})
			return
		}
		adminapi.WriteError(w, http.StatusBadRequest, "not_publishable", "could not publish version (refresh and try again)")
		return
	}
	meta, _ := json.Marshal(map[string]any{"promotion_version_id": vid, "offer_family": fam, "eligibility_fingerprint": fp})
	h.auditExec(ctx, "bonushub.publish_version", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'bonushub.publish_version', 'promotion_versions', $2, $3::jsonb)
	`, staffID, strconv.FormatInt(vid, 10), meta)
	_ = bonusblueocean.SyncPromotionVersionDryRun(ctx, h.Pool, h.Cfg, h.BOG, vid)
	writeJSON(w, map[string]any{"ok": true, "offer_family": fam, "eligibility_fingerprint": fp})
}

func (h *Handler) bonusHubListInstances(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(r.URL.Query().Get("user_id"))
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	var rows pgx.Rows
	var err error
	if uid != "" {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT bi.id::text, bi.user_id::text, COALESCE(u.email, ''), COALESCE(u.username, ''), bi.promotion_version_id, bi.status, bi.granted_amount_minor, bi.currency,
				bi.wr_required_minor, bi.wr_contributed_minor, bi.max_bet_violations_count, bi.idempotency_key, bi.created_at
			FROM user_bonus_instances bi
			LEFT JOIN users u ON u.id = bi.user_id
			WHERE bi.user_id = $1::uuid ORDER BY bi.created_at DESC LIMIT $2
		`, uid, limit)
	} else {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT bi.id::text, bi.user_id::text, COALESCE(u.email, ''), COALESCE(u.username, ''), bi.promotion_version_id, bi.status, bi.granted_amount_minor, bi.currency,
				bi.wr_required_minor, bi.wr_contributed_minor, bi.max_bet_violations_count, bi.idempotency_key, bi.created_at
			FROM user_bonus_instances bi
			LEFT JOIN users u ON u.id = bi.user_id
			ORDER BY bi.created_at DESC LIMIT $1
		`, limit)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, userID, userEmail, userName string
		var pvid int64
		var status, ccy, idem string
		var granted, wrReq, wrDone int64
		var maxBetViol int32
		var ct time.Time
		if err := rows.Scan(&id, &userID, &userEmail, &userName, &pvid, &status, &granted, &ccy, &wrReq, &wrDone, &maxBetViol, &idem, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "user_id": userID, "promotion_version_id": pvid, "status": status,
			"granted_amount_minor": granted, "currency": ccy, "wr_required_minor": wrReq, "wr_contributed_minor": wrDone,
			"max_bet_violations_count": maxBetViol,
			"idempotency_key":          idem, "created_at": ct.UTC().Format(time.RFC3339),
			"user_email": userEmail, "user_username": userName,
		})
	}
	writeJSON(w, map[string]any{"instances": list})
}

func (h *Handler) bonusHubForfeitInstance(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if id == "" || strings.TrimSpace(body.Reason) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "reason required")
		return
	}
	if err := bonus.ForfeitInstance(r.Context(), h.Pool, id, staffID, body.Reason, false); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "forfeit_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

type manualGrantReq struct {
	UserID             string `json:"user_id"`
	PromotionVersionID int64  `json:"promotion_version_id"`
	GrantAmountMinor   int64  `json:"grant_amount_minor"`
	Currency           string `json:"currency"`
	// BonusInstanceID is required when CreditTarget is "bonus_active" (top-up existing instance).
	BonusInstanceID string `json:"bonus_instance_id"`
	// CreditTarget: "cash" (default) — withdrawable / seamless real balance;
	// "bonus_locked" — new promo instance + bonus_locked;
	// "bonus_active" — credit into an existing active instance (extends WR from rules).
	CreditTarget      string `json:"credit_target"`
	AllowWithdrawable bool   `json:"allow_withdrawable"`
	// IdempotencyKey is OPTIONAL but strongly preferred. Front-end should
	// generate a UUID once when the grant modal opens and resend the same
	// value on retry. When absent, the server derives a deterministic key from
	// (staff, offer, user) so a double-submit on the SAME staff session for
	// the SAME offer/player resolves idempotently — without this fallback the
	// previous code minted a fresh UUID per request and double-clicks created
	// two grants.
	IdempotencyKey string `json:"idempotency_key"`
}

func (h *Handler) bonusHubManualGrant(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body manualGrantReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.UserID) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "user_id required")
		return
	}
	ccy := strings.TrimSpace(body.Currency)
	if ccy == "" {
		// Match Blue Ocean seamless settlement — USDT bonuses do not spend in EUR/ETH game wallets.
		ccy = h.resolveSeamlessManualCashCurrency()
	}
	ccy = strings.ToUpper(ccy)
	ctx := r.Context()
	uid := strings.TrimSpace(body.UserID)
	creditTarget := strings.ToLower(strings.TrimSpace(body.CreditTarget))
	if creditTarget == "" {
		creditTarget = "cash"
	}
	if creditTarget != "bonus_locked" && creditTarget != "cash" && creditTarget != "bonus_active" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "credit_target must be cash, bonus_locked, or bonus_active")
		return
	}
	if creditTarget == "bonus_active" && body.GrantAmountMinor <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "bonus_active requires grant_amount_minor > 0")
		return
	}
	cashAmountGrant := body.GrantAmountMinor > 0 && creditTarget == "cash"
	bonusActiveGrant := body.GrantAmountMinor > 0 && creditTarget == "bonus_active"
	if bonusActiveGrant {
		bi := strings.TrimSpace(body.BonusInstanceID)
		if bi == "" {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "bonus_instance_id required for bonus_active credit target")
			return
		}
		idem := manualTopUpIdempotencyKey(body.IdempotencyKey, staffID, bi, uid)
		inserted, err := bonus.TopUpActiveInstance(ctx, h.Pool, bonus.TopUpActiveInstanceArgs{
			UserID:         uid,
			InstanceID:     bi,
			AddAmountMinor: body.GrantAmountMinor,
			IdempotencyKey: idem,
			ActorStaffID:   staffID,
		})
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "grant_failed", err.Error())
			return
		}
		playMulti := h.cfg().BlueOceanMulticurrency
		afterBon, _ := ledger.BalanceBonusLockedSeamless(ctx, h.Pool, uid, ccy, playMulti)
		auditMeta := map[string]any{
			"user_id":                body.UserID,
			"bonus_instance_id":      bi,
			"grant_amount_minor":     body.GrantAmountMinor,
			"currency":               ccy,
			"credit_target":          "bonus_active",
			"funding_source":         "brand_bonus_wallet",
			"credit_pocket":          "bonus_locked",
			"wagering_terms_applied": true,
		}
		metaJSON, _ := json.Marshal(auditMeta)
		h.auditExec(ctx, "bonushub.manual_grant", `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'bonushub.manual_grant', 'user_bonus_instances', $2::jsonb)
		`, staffID, metaJSON)
		writeJSON(w, map[string]any{
			"inserted":                      inserted,
			"mode":                          "bonus_active_top_up",
			"pocket":                        "bonus_locked",
			"funding_source":                "brand_bonus_wallet",
			"bonus_instance_id":             bi,
			"terms_note":                    "Wagering requirement extended per promotion rules applied to the top-up amount",
			"bonus_locked_balance_minor":    afterBon,
			"bonus_locked_balance_currency": ccy,
		})
		return
	}
	if !cashAmountGrant && body.PromotionVersionID <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "promotion_version_id required")
		return
	}
	withdrawOverride := "block_withdraw"
	if body.AllowWithdrawable {
		withdrawOverride = ""
	}
	// Seamless / cash wallet path (no bonus instance — matches provider test-style real balance for BO).
	if body.GrantAmountMinor > 0 && creditTarget == "cash" {
		reqCcy := strings.ToUpper(strings.TrimSpace(body.Currency))
		ccy = h.resolveSeamlessManualCashCurrency()
		idem := manualCashPlayCreditIdempotencyKey(body.IdempotencyKey, staffID, uid, body.GrantAmountMinor, ccy)
		meta := map[string]any{
			"staff_user_id":      staffID,
			"credit_target":      "cash",
			"entry_type":         ledger.EntryTypeAdminPlayCredit,
			"allow_withdrawable": body.AllowWithdrawable,
		}
		if reqCcy != "" && reqCcy != ccy {
			meta["requested_currency"] = reqCcy
		}
		inserted, err := ledger.ApplyCredit(ctx, h.Pool, uid, ccy, ledger.EntryTypeAdminPlayCredit, idem, body.GrantAmountMinor, meta)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "grant_failed", err.Error())
			return
		}
		playMulti := h.cfg().BlueOceanMulticurrency
		afterBal, _ := ledger.BalancePlayableSeamless(ctx, h.Pool, uid, ccy, playMulti)
		auditMeta := map[string]any{
			"user_id":              body.UserID,
			"promotion_version_id": body.PromotionVersionID,
			"grant_amount_minor":   body.GrantAmountMinor,
			"currency":             ccy,
			"credit_target":        "cash",
			"funding_source":       "admin_play_credit",
			"credit_pocket":        "cash",
			"withdrawable":         body.AllowWithdrawable,
			"allow_withdrawable":   body.AllowWithdrawable,
			"seamless_note":        "Manual cash credits always post in BLUEOCEAN_CURRENCY so seamless games can debit/credit the same balance.",
		}
		if reqCcy != "" && reqCcy != ccy {
			auditMeta["requested_currency"] = reqCcy
		}
		metaJSON, _ := json.Marshal(auditMeta)
		h.auditExec(ctx, "bonushub.manual_grant", `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'bonushub.manual_grant', 'ledger_entries', $2::jsonb)
		`, staffID, metaJSON)
		resp := map[string]any{
			"inserted":                  inserted,
			"mode":                      "seamless_cash",
			"currency":                  ccy,
			"pocket":                    "cash",
			"withdrawable":              body.AllowWithdrawable,
			"funding_source":            "admin_play_credit",
			"terms_note":                "Credited in settlement currency (" + ccy + ") for Blue Ocean games; UI currency selection does not override.",
			"playable_balance_minor":    afterBal,
			"playable_balance_currency": ccy,
		}
		if reqCcy != "" && reqCcy != ccy {
			resp["requested_currency"] = reqCcy
		}
		if !inserted {
			resp["ledger_unchanged_reason"] = "idempotency_duplicate"
			resp["note"] = "This idempotency key already has a ledger row (same staff, amount, settlement currency, and client key if any). Use a new Idempotency-Key / retry with a fresh grant flow, or pick a different amount if you need another credit."
		}
		writeJSON(w, resp)
		return
	}
	// Bonus (promo) grant path
	if body.GrantAmountMinor > 0 {
		idem := manualGrantIdempotencyKey(body.IdempotencyKey, staffID, body.PromotionVersionID, uid)
		inserted, err := bonus.GrantFromPromotionVersion(ctx, h.Pool, bonus.GrantArgs{
			UserID:                 uid,
			PromotionVersionID:     body.PromotionVersionID,
			IdempotencyKey:         idem,
			GrantAmountMinor:       body.GrantAmountMinor,
			Currency:               ccy,
			DepositAmountMinor:     0,
			AllowPausedPromotion:   true,
			ActorStaffID:           staffID,
			WithdrawPolicyOverride: withdrawOverride,
		})
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "grant_failed", err.Error())
			return
		}
		auditMeta := map[string]any{
			"user_id":                body.UserID,
			"promotion_version_id":   body.PromotionVersionID,
			"grant_amount_minor":     body.GrantAmountMinor,
			"currency":               body.Currency,
			"funding_source":         "brand_bonus_wallet",
			"credit_pocket":          "bonus_locked",
			"withdrawable":           body.AllowWithdrawable,
			"allow_withdrawable":     body.AllowWithdrawable,
			"wagering_terms_applied": true,
		}
		meta, _ := json.Marshal(auditMeta)
		h.auditExec(ctx, "bonushub.manual_grant", `
			INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
			VALUES ($1::uuid, 'bonushub.manual_grant', 'user_bonus_instances', $2::jsonb)
		`, staffID, meta)
		writeJSON(w, map[string]any{
			"inserted":       inserted,
			"mode":           "play_only_bonus_locked",
			"withdrawable":   body.AllowWithdrawable,
			"pocket":         "bonus_locked",
			"funding_source": "brand_bonus_wallet",
			"terms_note":     "release/withdraw eligibility follows promotion wagering and terms",
			"withdraw_policy_applied": map[string]any{
				"default_non_withdrawable": !body.AllowWithdrawable,
				"allow_withdrawable":       body.AllowWithdrawable,
			},
		})
		return
	}
	// free spins only: grant_amount_minor=0, rules must define free_spin package
	var rulesJSON []byte
	if err := h.Pool.QueryRow(ctx, `SELECT rules FROM promotion_versions WHERE id = $1`, body.PromotionVersionID).Scan(&rulesJSON); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "promotion version not found")
		return
	}
	fsR, fsBet, fsGid, fok, err2 := bonus.FreeSpinSpecFromRulesJSON(rulesJSON)
	if err2 != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_rules", err2.Error())
		return
	}
	if !fok {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "grant_amount_minor must be > 0, or rules must include free rounds + game_id")
		return
	}
	idem := manualFreeSpinIdempotencyKey(body.IdempotencyKey, staffID, body.PromotionVersionID, uid)
	ins, err := bonus.EnqueueFreeSpinFromPromotionVersion(ctx, h.Pool, bonus.FreeSpinEnqueueArgs{
		UserID:               uid,
		PromotionVersionID:   body.PromotionVersionID,
		IdempotencyKey:       idem,
		Rounds:               fsR,
		GameID:               fsGid,
		BetPerRoundMinor:     fsBet,
		Source:               "admin_manual",
		AllowPausedPromotion: true,
		ActorStaffID:         staffID,
	})
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "grant_failed", err.Error())
		return
	}
	auditMeta := map[string]any{
		"user_id":                body.UserID,
		"promotion_version_id":   body.PromotionVersionID,
		"grant_amount_minor":     body.GrantAmountMinor,
		"currency":               body.Currency,
		"funding_source":         "brand_bonus_wallet",
		"credit_pocket":          "bonus_locked",
		"withdrawable":           body.AllowWithdrawable,
		"allow_withdrawable":     body.AllowWithdrawable,
		"wagering_terms_applied": true,
	}
	meta, _ := json.Marshal(auditMeta)
	h.auditExec(ctx, "bonushub.manual_grant", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'bonushub.manual_grant', 'user_bonus_instances', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{
		"inserted":       ins,
		"mode":           "free_spins_play_only",
		"withdrawable":   body.AllowWithdrawable,
		"funding_source": "brand_bonus_wallet",
		"terms_note":     "release/withdraw eligibility follows promotion wagering and terms",
		"withdraw_policy_applied": map[string]any{
			"default_non_withdrawable": !body.AllowWithdrawable,
			"allow_withdrawable":       body.AllowWithdrawable,
		},
	})
}

func (h *Handler) userEconomicTimeline(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(chi.URLParam(r, "id"))
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "missing user id")
		return
	}
	ctx := r.Context()
	legRows, err := h.Pool.Query(ctx, `
		SELECT id, amount_minor, currency, entry_type, idempotency_key, pocket, created_at
		FROM ledger_entries WHERE user_id = $1::uuid ORDER BY id DESC LIMIT 80
	`, uid)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "ledger failed")
		return
	}
	defer legRows.Close()
	var ledgerLines []map[string]any
	for legRows.Next() {
		var id int64
		var amt int64
		var ccy, et, idem, pocket string
		var ct time.Time
		if err := legRows.Scan(&id, &amt, &ccy, &et, &idem, &pocket, &ct); err != nil {
			continue
		}
		ledgerLines = append(ledgerLines, map[string]any{
			"kind": "ledger", "id": id, "amount_minor": amt, "currency": ccy, "entry_type": et,
			"idempotency_key": idem, "pocket": pocket, "at": ct.UTC().Format(time.RFC3339),
		})
	}

	biRows, err := h.Pool.Query(ctx, `
		SELECT id::text, promotion_version_id, status, granted_amount_minor, wr_required_minor, wr_contributed_minor, idempotency_key, created_at
		FROM user_bonus_instances WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 40
	`, uid)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "bonus failed")
		return
	}
	defer biRows.Close()
	var bonuses []map[string]any
	for biRows.Next() {
		var id, idem string
		var pvid int64
		var st string
		var g, wr, wc int64
		var ct time.Time
		if err := biRows.Scan(&id, &pvid, &st, &g, &wr, &wc, &idem, &ct); err != nil {
			continue
		}
		bonuses = append(bonuses, map[string]any{
			"kind": "bonus_instance", "id": id, "promotion_version_id": pvid, "status": st,
			"granted_amount_minor": g, "wr_required_minor": wr, "wr_contributed_minor": wc,
			"idempotency_key": idem, "at": ct.UTC().Format(time.RFC3339),
		})
	}

	cbRows, err := h.Pool.Query(ctx, `
		SELECT provider, COALESCE(provider_event_id,''), processing_status, created_at
		FROM payment_deposit_callbacks
		WHERE payload::text ILIKE '%' || $1 || '%'
		ORDER BY created_at DESC LIMIT 30
	`, uid)
	if err != nil {
		cbRows = nil
	}
	var paymentCallbacks []map[string]any
	if cbRows != nil {
		defer cbRows.Close()
		for cbRows.Next() {
			var prov, peid, proc string
			var ct time.Time
			if err := cbRows.Scan(&prov, &peid, &proc, &ct); err != nil {
				continue
			}
			paymentCallbacks = append(paymentCallbacks, map[string]any{
				"kind": "payment_deposit_callback", "provider": prov, "provider_event_id": peid,
				"processing_status": proc, "at": ct.UTC().Format(time.RFC3339),
			})
		}
	}

	cash, _ := ledger.BalanceCash(ctx, h.Pool, uid)
	bon, _ := ledger.BalanceBonusLocked(ctx, h.Pool, uid)
	play, _ := ledger.BalanceMinor(ctx, h.Pool, uid)

	writeJSON(w, map[string]any{
		"user_id":                 uid,
		"balances":                map[string]any{"cash_minor": cash, "bonus_locked_minor": bon, "playable_minor": play},
		"ledger":                  ledgerLines,
		"bonus_instances":         bonuses,
		"payment_callbacks_guess": paymentCallbacks,
	})
}

func (h *Handler) bonusHubRiskQueue(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	list, err := bonus.ListPendingReviews(r.Context(), h.Pool, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	pending := bonus.ReviewQueuePending(r.Context(), h.Pool)
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, map[string]any{"pending_count": pending, "reviews": list})
}

func (h *Handler) bonusHubResolveRiskReview(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	var body struct {
		Decision string `json:"decision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Decision != "allowed" && body.Decision != "denied") {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "decision must be 'allowed' or 'denied'")
		return
	}
	if err := bonus.ResolveReview(r.Context(), h.Pool, id, body.Decision); err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "review not found or already resolved")
		return
	}
	staffID, _ := adminapi.StaffIDFromContext(r.Context())
	meta, _ := json.Marshal(map[string]any{"decision_id": id, "decision": body.Decision})
	h.auditExec(r.Context(), "bonushub.resolve_risk_review", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'bonushub.resolve_risk_review', 'bonus_risk_decisions', $2, $3::jsonb)
	`, staffID, strconv.FormatInt(id, 10), meta)
	writeJSON(w, map[string]any{"ok": true})
}

// isPGUniqueViolation reports PostgreSQL unique_violation (23505).
func isPGUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

// resolveSeamlessManualCashCurrency returns BLUEOCEAN settlement currency for admin "cash" credits.
// Manual play credits must always tag this currency: Blue Ocean seamless balance is queried per session
// currency from config/callback; posting USDT while games settle EUR leaves the credit invisible to the provider.
// The admin UI may still send a different currency — it is ignored for the ledger (see requested_currency in meta).
func (h *Handler) resolveSeamlessManualCashCurrency() string {
	cfg := h.cfg()
	bo := strings.ToUpper(strings.TrimSpace(cfg.BlueOceanCurrency))
	if bo == "" {
		bo = "EUR"
	}
	return bo
}

// manualCashPlayCreditIdempotencyKey idempotency for admin cash / seamless credits.
// Ledger currency must be part of the key: a prior line tagged USDT with the old
// staff/user/amount key would otherwise block a new EUR credit at the same amount
// (ON CONFLICT DO NOTHING → inserted=false, no in-game balance change).
// Client UUID path includes amount + currency so a single UUID cannot accidentally
// dedupe two different amounts; deterministic path uses staff/user/amount/currency.
func manualCashPlayCreditIdempotencyKey(clientKey, staffID, userID string, amountMinor int64, ledgerCurrency string) string {
	ccy := strings.ToUpper(strings.TrimSpace(ledgerCurrency))
	if ccy == "" {
		ccy = "EUR"
	}
	if k := strings.TrimSpace(clientKey); k != "" {
		return fmt.Sprintf("admin:play:credit:client:%s:%d:%s", k, amountMinor, ccy)
	}
	return fmt.Sprintf("admin:play:credit:%s:%s:%d:%s", staffID, userID, amountMinor, ccy)
}

// manualGrantIdempotencyKey resolves the idempotency key for a manual admin
// grant. Preference order:
//
//  1. Client-supplied IdempotencyKey (UI sends a UUID created when the modal
//     opens; resends preserve the same key — single grant on retry).
//  2. Deterministic key derived from (staff, promotion, user). This guarantees
//     a double-submit on the SAME staff session for the SAME (offer, player)
//     deduplicates against the existing user_bonus_instances unique constraint
//     instead of creating a second grant. Two different staff members granting
//     the same offer to the same player still get distinct keys, which is what
//     we want — they are deliberately separate manual interventions.
func manualGrantIdempotencyKey(clientKey, staffID string, promotionVersionID int64, userID string) string {
	if k := strings.TrimSpace(clientKey); k != "" {
		return "bonus:grant:admin:client:" + k
	}
	return fmt.Sprintf("bonus:grant:admin:%s:%d:%s", staffID, promotionVersionID, userID)
}

// manualTopUpIdempotencyKey deduplicates admin top-ups to an existing bonus instance.
func manualTopUpIdempotencyKey(clientKey, staffID, bonusInstanceID, userID string) string {
	bi := strings.TrimSpace(bonusInstanceID)
	if k := strings.TrimSpace(clientKey); k != "" {
		return "bonus:topup:admin:client:" + k + ":" + bi
	}
	return fmt.Sprintf("bonus:topup:admin:%s:%s:%s", staffID, bi, userID)
}

// manualFreeSpinIdempotencyKey is the free-spin equivalent of
// manualGrantIdempotencyKey. Same shape, different prefix so a cash grant and
// a free spin grant for the same (staff, offer, user) tuple do not collide.
func manualFreeSpinIdempotencyKey(clientKey, staffID string, promotionVersionID int64, userID string) string {
	if k := strings.TrimSpace(clientKey); k != "" {
		return "bonus:fs:admin:client:" + k
	}
	return fmt.Sprintf("bonus:fs:admin:%s:%d:%s", staffID, promotionVersionID, userID)
}

func normalizeAdminColor(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	s := strings.TrimSpace(*raw)
	if s == "" {
		return nil, nil
	}
	if len(s) != 7 || s[0] != '#' {
		return nil, errors.New("admin_color must be a hex color like #3B82F6")
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return nil, errors.New("admin_color must be a hex color like #3B82F6")
		}
	}
	normalized := strings.ToUpper(s)
	return &normalized, nil
}
