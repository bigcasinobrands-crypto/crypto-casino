package adminops

import (
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
	"github.com/google/uuid"
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
		b.With(adminapi.RequireAnyRole("superadmin")).Patch("/promotions/{id}", h.bonusHubPatchPromotion)
		b.Post("/promotions/{id}/versions", h.bonusHubAddVersion)
		b.Post("/promotion-versions/{vid}/publish", h.bonusHubPublishVersion)
		b.Get("/reward-programs", h.bonusHubListRewardPrograms)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/reward-programs", h.bonusHubCreateRewardProgram)
		b.Get("/automation-rules", h.bonusHubListAutomationRules)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/automation-rules", h.bonusHubCreateAutomationRule)
		b.With(adminapi.RequireAnyRole("superadmin")).Patch("/automation-rules/{id}", h.bonusHubPatchAutomationRule)
		b.Get("/worker-failed-jobs", h.bonusHubListWorkerFailedJobs)
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
		b.Post("/instances/{id}/forfeit", h.bonusHubForfeitInstance)
		b.With(adminapi.RequireAnyRole("superadmin")).Post("/instances/grant", h.bonusHubManualGrant)
	})
	r.Get("/users/{id}/economic-timeline", h.userEconomicTimeline)
}

func (h *Handler) bonusHubDashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var promos, instActive, grants24 int64
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM promotions WHERE status != 'archived'`).Scan(&promos)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status = 'active'`).Scan(&instActive)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE created_at > now() - interval '24 hours'
	`).Scan(&grants24)
	riskPending := bonus.ReviewQueuePending(ctx, h.Pool)

	var bonusCost30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(granted_amount_minor), 0)::bigint FROM user_bonus_instances
		WHERE created_at > now() - interval '30 days'
	`).Scan(&bonusCost30d)

	var totalCompleted, totalForfeited, totalNonPending int64
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status = 'completed'`).Scan(&totalCompleted)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status = 'forfeited'`).Scan(&totalForfeited)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM user_bonus_instances WHERE status NOT IN ('pending','pending_review')`).Scan(&totalNonPending)

	var wrCompletionRate, forfeitureRate float64
	if totalNonPending > 0 {
		wrCompletionRate = float64(totalCompleted) / float64(totalNonPending) * 100
		forfeitureRate = float64(totalForfeited) / float64(totalNonPending) * 100
	}

	var avgGrantMinor int64
	_ = h.Pool.QueryRow(ctx, `SELECT COALESCE(AVG(granted_amount_minor), 0)::bigint FROM user_bonus_instances`).Scan(&avgGrantMinor)

	var ggr30d int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(
			SUM(CASE WHEN entry_type='game.bet' THEN ABS(amount_minor) ELSE 0 END) -
			SUM(CASE WHEN entry_type='game.win' THEN amount_minor ELSE 0 END), 0
		)::bigint FROM ledger_entries
		WHERE entry_type IN ('game.bet','game.win') AND created_at > now() - interval '30 days'
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
		"forfeiture_rate":         forfeitureRate,
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
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
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
			(SELECT MAX(version) FROM promotion_versions pv WHERE pv.promotion_id = p.id) AS max_ver,
			(SELECT pv2.bonus_type FROM promotion_versions pv2 WHERE pv2.promotion_id = p.id ORDER BY pv2.version DESC LIMIT 1) AS bonus_type
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
		var bonusType *string
		if err := rows.Scan(&id, &name, &slug, &status, &ct, &grantsPaused, &maxVer, &bonusType); err != nil {
			continue
		}
		entry := map[string]any{
			"id": id, "name": name, "slug": slug, "status": status,
			"created_at": ct.UTC().Format(time.RFC3339), "latest_version": maxVer,
			"grants_paused": grantsPaused,
		}
		if bonusType != nil && *bonusType != "" {
			entry["bonus_type"] = *bonusType
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
	Name string `json:"name"`
	Slug string `json:"slug"`
}

func (h *Handler) bonusHubCreatePromotion(w http.ResponseWriter, r *http.Request) {
	var body createPromoReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Slug) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "name and slug required")
		return
	}
	var id int64
	err := h.Pool.QueryRow(r.Context(), `
		INSERT INTO promotions (name, slug) VALUES ($1, $2) RETURNING id
	`, strings.TrimSpace(body.Name), strings.TrimSpace(body.Slug)).Scan(&id)
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
	var ct time.Time
	var grantsPaused bool
	err = h.Pool.QueryRow(r.Context(), `SELECT name, slug, status, created_at, COALESCE(grants_paused, false) FROM promotions WHERE id = $1`, id).Scan(&name, &slug, &status, &ct, &grantsPaused)
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
			rules, COALESCE(terms_text,''), bonus_type
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
		if err := rows.Scan(&vid, &ver, &pub, &vct, &vf, &vt, &rulesJSON, &terms, &bonusType); err != nil {
			continue
		}
		entry := map[string]any{
			"id": vid, "version": ver, "published": pub, "created_at": vct.UTC().Format(time.RFC3339),
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
		vers = append(vers, entry)
	}
	writeJSON(w, map[string]any{
		"id": id, "name": name, "slug": slug, "status": status,
		"created_at": ct.UTC().Format(time.RFC3339), "versions": vers,
		"grants_paused": grantsPaused,
	})
}

type patchPromoReq struct {
	GrantsPaused *bool   `json:"grants_paused"`
	Status       *string `json:"status"`
}

func (h *Handler) bonusHubPatchPromotion(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
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
	if body.GrantsPaused == nil && body.Status == nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "at least one of grants_paused, status required")
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
	var res pgconn.CommandTag
	var execErr error
	if body.GrantsPaused != nil && body.Status != nil {
		res, execErr = h.Pool.Exec(ctx, `UPDATE promotions SET grants_paused = $2, status = $3, updated_at = now() WHERE id = $1`, id, *body.GrantsPaused, newStatus)
	} else if body.Status != nil {
		res, execErr = h.Pool.Exec(ctx, `UPDATE promotions SET status = $2, updated_at = now() WHERE id = $1`, id, newStatus)
	} else {
		res, execErr = h.Pool.Exec(ctx, `UPDATE promotions SET grants_paused = $2, updated_at = now() WHERE id = $1`, id, *body.GrantsPaused)
	}
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
	metaB, _ := json.Marshal(meta)
	_, _ = h.Pool.Exec(r.Context(), `
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
	Rules     json.RawMessage `json:"rules"`
	TermsText string          `json:"terms_text"`
	BonusType *string         `json:"bonus_type"`
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
	var vid int64
	err = h.Pool.QueryRow(ctx, `
		INSERT INTO promotion_versions (promotion_id, version, rules, terms_text, bonus_type)
		VALUES ($1, $2, $3::jsonb, NULLIF($4,''), $5) RETURNING id
	`, pid, next, body.Rules, strings.TrimSpace(body.TermsText), bt).Scan(&vid)
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
	err = h.Pool.QueryRow(ctx, `
		SELECT rules, offer_family, dedupe_group_key FROM promotion_versions WHERE id = $1 AND published_at IS NULL
	`, vid).Scan(&rulesJSON, &offerFam, &dedupe)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "not_publishable", "version missing or already published")
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
					"code":                  "dedupe_conflict",
					"message":               err.Error(),
					"conflict_version_id":   c.ConflictVersionID,
					"promotion_name":        c.PromotionName,
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
		adminapi.WriteError(w, http.StatusBadRequest, "not_publishable", "version missing or already published")
		return
	}
	meta, _ := json.Marshal(map[string]any{"promotion_version_id": vid, "offer_family": fam, "eligibility_fingerprint": fp})
	_, _ = h.Pool.Exec(ctx, `
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
			SELECT bi.id::text, bi.user_id::text, bi.promotion_version_id, bi.status, bi.granted_amount_minor, bi.currency,
				bi.wr_required_minor, bi.wr_contributed_minor, bi.idempotency_key, bi.created_at
			FROM user_bonus_instances bi WHERE bi.user_id = $1::uuid ORDER BY bi.created_at DESC LIMIT $2
		`, uid, limit)
	} else {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT bi.id::text, bi.user_id::text, bi.promotion_version_id, bi.status, bi.granted_amount_minor, bi.currency,
				bi.wr_required_minor, bi.wr_contributed_minor, bi.idempotency_key, bi.created_at
			FROM user_bonus_instances bi ORDER BY bi.created_at DESC LIMIT $1
		`, limit)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, userID string
		var pvid int64
		var status, ccy, idem string
		var granted, wrReq, wrDone int64
		var ct time.Time
		if err := rows.Scan(&id, &userID, &pvid, &status, &granted, &ccy, &wrReq, &wrDone, &idem, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "user_id": userID, "promotion_version_id": pvid, "status": status,
			"granted_amount_minor": granted, "currency": ccy, "wr_required_minor": wrReq, "wr_contributed_minor": wrDone,
			"idempotency_key": idem, "created_at": ct.UTC().Format(time.RFC3339),
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
	if err := bonus.ForfeitInstance(r.Context(), h.Pool, id, staffID, body.Reason); err != nil {
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
}

func (h *Handler) bonusHubManualGrant(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body manualGrantReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.UserID) == "" || body.PromotionVersionID <= 0 || body.GrantAmountMinor <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "user_id, promotion_version_id, grant_amount_minor required")
		return
	}
	ccy := strings.TrimSpace(body.Currency)
	if ccy == "" {
		ccy = "USDT"
	}
	idem := "bonus:grant:admin:" + staffID + ":" + uuid.New().String()
	inserted, err := bonus.GrantFromPromotionVersion(r.Context(), h.Pool, bonus.GrantArgs{
		UserID:               strings.TrimSpace(body.UserID),
		PromotionVersionID:   body.PromotionVersionID,
		IdempotencyKey:       idem,
		GrantAmountMinor:     body.GrantAmountMinor,
		Currency:             ccy,
		DepositAmountMinor:   0,
		AllowPausedPromotion: true,
	})
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "grant_failed", err.Error())
		return
	}
	meta, _ := json.Marshal(body)
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'bonushub.manual_grant', 'user_bonus_instances', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"inserted": inserted})
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

	fsRows, err := h.Pool.Query(ctx, `
		SELECT dedupe_key, event_type, resource_id, processed, created_at FROM fystack_webhook_deliveries
		WHERE raw::text ILIKE '%' || $1 || '%' ORDER BY id DESC LIMIT 30
	`, uid)
	if err != nil {
		fsRows = nil
	}
	var fystack []map[string]any
	if fsRows != nil {
		defer fsRows.Close()
		for fsRows.Next() {
			var dk, et, rid string
			var proc bool
			var ct time.Time
			if err := fsRows.Scan(&dk, &et, &rid, &proc, &ct); err != nil {
				continue
			}
			fystack = append(fystack, map[string]any{
				"kind": "fystack_webhook", "dedupe_key": dk, "event_type": et, "resource_id": rid,
				"processed": proc, "at": ct.UTC().Format(time.RFC3339),
			})
		}
	}

	cash, _ := ledger.BalanceCash(ctx, h.Pool, uid)
	bon, _ := ledger.BalanceBonusLocked(ctx, h.Pool, uid)
	play, _ := ledger.BalanceMinor(ctx, h.Pool, uid)

	writeJSON(w, map[string]any{
		"user_id":                uid,
		"balances":               map[string]any{"cash_minor": cash, "bonus_locked_minor": bon, "playable_minor": play},
		"ledger":                 ledgerLines,
		"bonus_instances":        bonuses,
		"fystack_webhooks_guess": fystack,
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
	_, _ = h.Pool.Exec(r.Context(), `
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
