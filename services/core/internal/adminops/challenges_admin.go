package adminops

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/challenges"
	"github.com/crypto-casino/core/internal/games"
	"github.com/go-chi/chi/v5"
)

func gameIDFromJSONElement(e any) string {
	switch v := e.(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strings.TrimSpace(strconv.FormatFloat(v, 'f', -1, 64))
	case json.Number:
		return strings.TrimSpace(v.String())
	default:
		return ""
	}
}

// parsePostgresTextArrayBraces parses a postgres text[] literal like {a,"b",c} into IDs.
func parsePostgresTextArrayBraces(s string) []string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "{") || !strings.HasSuffix(s, "}") {
		return nil
	}
	inner := strings.TrimSpace(s[1 : len(s)-1])
	if inner == "" {
		return []string{}
	}
	var parts []string
	var b strings.Builder
	inQuote := false
	for i := 0; i < len(inner); i++ {
		c := inner[i]
		switch {
		case c == '"':
			inQuote = !inQuote
		case c == ',' && !inQuote:
			parts = append(parts, strings.TrimSpace(b.String()))
			b.Reset()
		default:
			b.WriteByte(c)
		}
	}
	parts = append(parts, strings.TrimSpace(b.String()))
	var out []string
	for _, p := range parts {
		p = strings.Trim(strings.TrimSpace(p), `"`)
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func parseGameIDSlice(v any) []string {
	if v == nil {
		return nil
	}
	switch x := v.(type) {
	case []string:
		out := make([]string, 0, len(x))
		for _, s := range x {
			if t := strings.TrimSpace(s); t != "" {
				out = append(out, t)
			}
		}
		return out
	case []any:
		var out []string
		for _, e := range x {
			if t := gameIDFromJSONElement(e); t != "" {
				out = append(out, t)
			}
		}
		return out
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return nil
		}
		if strings.HasPrefix(s, "[") {
			var arr []any
			if err := json.Unmarshal([]byte(s), &arr); err == nil {
				return parseGameIDSlice(arr)
			}
		}
		if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") {
			return parsePostgresTextArrayBraces(s)
		}
		return nil
	default:
		return nil
	}
}

func normalizeGameIDsInAdminDetailMap(m map[string]any) {
	if m == nil {
		return
	}
	raw, ok := m["game_ids"]
	if !ok || raw == nil {
		m["game_ids"] = []string{}
		return
	}
	ids := parseGameIDSlice(raw)
	if ids == nil {
		m["game_ids"] = []string{}
		return
	}
	m["game_ids"] = ids
}

func heroStringFromChallengeMap(m map[string]any) string {
	if m == nil {
		return ""
	}
	v, ok := m["hero_image_url"]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

// enrichChallengeHeroAdminMap fills or normalizes hero_image_url like listChallengesAdmin:
// DB value wins when set; otherwise use the first linked game catalog thumbnail.
func (h *Handler) enrichChallengeHeroAdminMap(ctx context.Context, m map[string]any) {
	if m == nil {
		return
	}
	imageBase := ""
	if h.Cfg != nil {
		imageBase = strings.TrimSpace(h.Cfg.BlueOceanImageBaseURL)
	}
	gameIDs := parseGameIDSlice(m["game_ids"])
	heroOut := heroStringFromChallengeMap(m)
	if heroOut == "" && len(gameIDs) > 0 {
		if fall := h.resolveHeroFromGames(ctx, gameIDs); fall != nil {
			heroOut = strings.TrimSpace(*fall)
		}
	} else if heroOut != "" {
		heroOut = strings.TrimSpace(blueocean.NormalizeCatalogImageURL(heroOut, imageBase))
	}
	if heroOut != "" {
		m["hero_image_url"] = heroOut
	} else {
		m["hero_image_url"] = ""
	}
}

func (h *Handler) resolveHeroFromGames(ctx context.Context, gameIDs []string) *string {
	base := ""
	if h != nil && h.Cfg != nil {
		base = strings.TrimSpace(h.Cfg.BlueOceanImageBaseURL)
	}
	for _, gid := range gameIDs {
		gid = strings.TrimSpace(gid)
		if gid == "" || h == nil || h.Pool == nil {
			continue
		}
		var thumb string
		err := h.Pool.QueryRow(ctx, `SELECT COALESCE(`+games.EffectiveThumbnailSQL+`, '') FROM games WHERE id = $1`, gid).Scan(&thumb)
		if err != nil {
			continue
		}
		norm := blueocean.NormalizeCatalogImageURL(thumb, base)
		if t := strings.TrimSpace(norm); t != "" {
			return &t
		}
	}
	return nil
}

func jsonFloatFromMap(m map[string]any, key string) (float64, bool) {
	v, ok := m[key]
	if !ok || v == nil {
		return 0, false
	}
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func jsonInt64FromMap(m map[string]any, key string) (int64, bool) {
	v, ok := m[key]
	if !ok || v == nil {
		return 0, false
	}
	switch x := v.(type) {
	case float64:
		return int64(x), true
	case int:
		return int64(x), true
	case int64:
		return x, true
	case json.Number:
		i, err := x.Int64()
		if err != nil {
			return 0, false
		}
		return i, true
	default:
		return 0, false
	}
}

func (h *Handler) mountChallenges(r chi.Router) {
	r.Get("/challenges/summary", h.challengesSummary)
	r.Get("/challenges/flagged", h.challengesFlaggedEntries)
	r.Get("/challenges", h.listChallengesAdmin)
	r.Get("/challenges/{id}", h.getChallengeAdmin)
	r.Get("/challenges/{id}/entries", h.listChallengeEntries)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/challenges", h.createChallenge)
	r.With(adminapi.RequireAnyRole("superadmin")).Delete("/challenges/{id}", h.deleteChallenge)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/challenges/{id}", h.patchChallenge)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/challenges/{id}/entries/{eid}", h.patchChallengeEntry)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/challenges/{id}/entries/{eid}/award", h.postAwardEntry)
}

func (h *Handler) challengesSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if h.dashboardDisplaySuppressed(ctx) {
		writeJSON(w, zeroChallengesSummaryMap())
		return
	}
	var active, drafts int
	var entries30, wager30, prizes30 int64
	var flagged int
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM challenges WHERE status = 'active' AND now() < ends_at`).Scan(&active)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM challenges WHERE status = 'draft'`).Scan(&drafts)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM challenge_entries WHERE entered_at > now() - interval '30 days'
	`).Scan(&entries30)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(bet_amount_minor), 0)::bigint FROM challenge_bet_events WHERE settled_at > now() - interval '30 days'
	`).Scan(&wager30)
	_ = h.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(prize_awarded_minor), 0)::bigint FROM challenge_entries WHERE prize_awarded_at > now() - interval '30 days'
	`).Scan(&prizes30)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM challenge_entries WHERE flagged_for_review = true AND status = 'active'`).Scan(&flagged)
	writeJSON(w, map[string]any{
		"active_challenges":       active,
		"draft_challenges":        drafts,
		"entries_last_30d":        entries30,
		"challenge_wagered_minor": wager30,
		"prizes_paid_minor_30d":   prizes30,
		"flagged_pending":         flagged,
	})
}

func (h *Handler) challengesFlaggedEntries(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT e.id::text, e.challenge_id::text, e.user_id::text, e.status, e.risk_score, e.flag_reasons, c.title
		FROM challenge_entries e
		JOIN challenges c ON c.id = e.challenge_id
		WHERE e.flagged_for_review = true
		ORDER BY e.risk_score DESC NULLS LAST, e.updated_at DESC
		LIMIT 200
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, cid, uid, st string
		var rs float64
		var fr []string
		var title string
		if err := rows.Scan(&id, &cid, &uid, &st, &rs, &fr, &title); err != nil {
			continue
		}
		m := map[string]any{"id": id, "challenge_id": cid, "user_id": uid, "status": st, "challenge_title": title, "risk_score": rs}
		if len(fr) > 0 {
			m["flag_reasons"] = fr
		}
		list = append(list, m)
	}
	writeJSON(w, map[string]any{"entries": list})
}

func (h *Handler) listChallengesAdmin(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := strings.TrimSpace(q.Get("status"))
	ctx := r.Context()
	imageBase := ""
	if h.Cfg != nil {
		imageBase = strings.TrimSpace(h.Cfg.BlueOceanImageBaseURL)
	}
	rows, err := h.Pool.Query(ctx, `
		SELECT id::text, slug, title, description, challenge_type, status, prize_type, max_winners, winners_count,
		       starts_at, ends_at, created_at,
		       hero_image_url, badge_label, min_bet_amount_minor, prize_amount_minor, prize_currency,
		       COALESCE(game_ids, '{}'::text[]),
		       COALESCE(vip_only, false)
		FROM challenges
		WHERE ($1 = '' OR status = $1)
		ORDER BY created_at DESC
		LIMIT 500
	`, status)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, slug, title, desc, ctype, st, ptype string
		var maxW, win int
		var starts, ends, created time.Time
		var hero, badge *string
		var minBet int64
		var prizeMinor sql.NullInt64
		var prizeCur string
		var gameIDs []string
		var vipOnly bool
		if err := rows.Scan(&id, &slug, &title, &desc, &ctype, &st, &ptype, &maxW, &win, &starts, &ends, &created, &hero, &badge, &minBet, &prizeMinor, &prizeCur, &gameIDs, &vipOnly); err != nil {
			continue
		}
		item := map[string]any{
			"id": id, "slug": slug, "title": title, "description": desc, "challenge_type": ctype, "status": st, "prize_type": ptype,
			"max_winners": maxW, "winners_count": win,
			"starts_at": starts.UTC().Format(time.RFC3339), "ends_at": ends.UTC().Format(time.RFC3339),
			"created_at":           created.UTC().Format(time.RFC3339),
			"min_bet_amount_minor": minBet,
			"prize_currency":       prizeCur,
			"vip_only":             vipOnly,
		}
		heroOut := ""
		if hero != nil {
			heroOut = strings.TrimSpace(*hero)
		}
		if heroOut == "" && len(gameIDs) > 0 {
			if fall := h.resolveHeroFromGames(ctx, gameIDs); fall != nil {
				heroOut = strings.TrimSpace(*fall)
			}
		} else if heroOut != "" {
			heroOut = strings.TrimSpace(blueocean.NormalizeCatalogImageURL(heroOut, imageBase))
		}
		if heroOut != "" {
			item["hero_image_url"] = heroOut
		} else {
			item["hero_image_url"] = ""
		}
		if badge != nil {
			item["badge_label"] = *badge
		} else {
			item["badge_label"] = ""
		}
		if prizeMinor.Valid {
			item["prize_amount_minor"] = prizeMinor.Int64
		}
		list = append(list, item)
	}
	writeJSON(w, map[string]any{"challenges": list})
}

func (h *Handler) createChallenge(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if err := dec.Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}
	slug, _ := body["slug"].(string)
	title, _ := body["title"].(string)
	if strings.TrimSpace(slug) == "" || strings.TrimSpace(title) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "validation", "slug and title required")
		return
	}
	ctype, _ := body["challenge_type"].(string)
	if ctype == "" {
		ctype = "multiplier"
	}
	desc, _ := body["description"].(string)
	if strings.TrimSpace(desc) == "" {
		desc = "Qualifying play on the selected game(s) during the challenge window; minimum bet per round applies."
	}
	rules, _ := body["rules"].(string)
	terms, _ := body["terms"].(string)
	status, _ := body["status"].(string)
	if status == "" {
		status = "draft"
	}
	gameIDs := parseGameIDSlice(body["game_ids"])

	imageBase := ""
	if h.Cfg != nil {
		imageBase = strings.TrimSpace(h.Cfg.BlueOceanImageBaseURL)
	}

	var hero *string
	if s, ok := body["hero_image_url"].(string); ok && strings.TrimSpace(s) != "" {
		n := blueocean.NormalizeCatalogImageURL(s, imageBase)
		if t := strings.TrimSpace(n); t != "" {
			hero = &t
		}
	}
	if hero == nil && len(gameIDs) > 0 {
		hero = h.resolveHeroFromGames(r.Context(), gameIDs)
	}

	prizeType, _ := body["prize_type"].(string)
	if strings.TrimSpace(prizeType) == "" {
		prizeType = "cash"
	}
	prizeCur, _ := body["prize_currency"].(string)
	if strings.TrimSpace(prizeCur) == "" {
		prizeCur = "USDT"
	}

	// Cash prizes always use in-app claim (player taps Claim); not configurable.
	reqClaim := true

	minBet, hasMin := jsonInt64FromMap(body, "min_bet_amount_minor")
	if !hasMin || minBet <= 0 {
		minBet = 100
	}
	maxWinners, hasMW := jsonInt64FromMap(body, "max_winners")
	if !hasMW || maxWinners <= 0 {
		maxWinners = 1
	}

	var tgtMult *float64
	var tgtWager *int64
	switch ctype {
	case "wager_volume":
		if v, ok := jsonInt64FromMap(body, "target_wager_amount_minor"); ok && v > 0 {
			tgtWager = &v
		}
	default:
		if v, ok := jsonFloatFromMap(body, "target_multiplier"); ok && v > 0 {
			tgtMult = &v
		}
	}

	var maxBet *int64
	if v, ok := jsonInt64FromMap(body, "max_bet_amount_minor"); ok && v > 0 {
		maxBet = &v
	}

	var prizeMinor *int64
	if v, ok := jsonInt64FromMap(body, "prize_amount_minor"); ok && v >= 0 {
		prizeMinor = &v
	}

	var badge *string
	if s, ok := body["badge_label"].(string); ok && strings.TrimSpace(s) != "" {
		b := strings.TrimSpace(s)
		badge = &b
	}

	featured := false
	if v, ok := body["is_featured"].(bool); ok {
		featured = v
	}

	vipOnly := false
	if v, ok := body["vip_only"].(bool); ok {
		vipOnly = v
	}
	var vipMinTier *string
	if v, ok := body["vip_tier_minimum"].(string); ok && strings.TrimSpace(v) != "" {
		s := strings.TrimSpace(v)
		vipMinTier = &s
	} else if n, ok := jsonInt64FromMap(body, "vip_tier_minimum"); ok && n > 0 {
		s := strconv.FormatInt(n, 10)
		vipMinTier = &s
	}
	if !vipOnly {
		vipMinTier = nil
	}

	var payoutAsset *string
	if s, ok := body["prize_payout_asset_key"].(string); ok && strings.TrimSpace(s) != "" {
		p := strings.TrimSpace(s)
		payoutAsset = &p
	}

	var sid *string
	if id, ok := adminapi.StaffIDFromContext(r.Context()); ok {
		sid = &id
	}
	var idOut string
	err := h.Pool.QueryRow(r.Context(), `
		INSERT INTO challenges (
		  slug, title, description, rules, terms, challenge_type, status,
		  min_bet_amount_minor, max_bet_amount_minor,
		  target_multiplier, target_wager_amount_minor,
		  prize_type, prize_currency, prize_amount_minor, max_winners,
		  starts_at, ends_at, created_by,
		  game_ids, hero_image_url, require_claim_for_prize, badge_label, is_featured,
		  vip_only, vip_tier_minimum, prize_payout_asset_key
		) VALUES (
		  $1, $2, $3, $4, $5, $6, $7,
		  $8::bigint, $9::bigint,
		  $10::numeric, $11::bigint,
		  $12, $13, $14::bigint, $15::int,
		  COALESCE($16::timestamptz, now()), COALESCE($17::timestamptz, now() + interval '7 days'), $18::uuid,
		  $19::text[], $20, $21, $22, $23,
		  $24, $25, $26
		) RETURNING id::text
	`, slug, title, desc, rules, terms, ctype, status,
		minBet, maxBet,
		tgtMult, tgtWager,
		prizeType, prizeCur, prizeMinor, maxWinners,
		body["starts_at"], body["ends_at"], sid,
		gameIDs, hero, reqClaim, badge, featured,
		vipOnly, vipMinTier, payoutAsset,
	).Scan(&idOut)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "insert_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{"id": idOut, "ok": true})
}

func (h *Handler) deleteChallenge(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "validation", "missing id")
		return
	}
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM challenges WHERE id = $1::uuid`, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "delete_failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "challenge not found")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) getChallengeAdmin(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	row := h.Pool.QueryRow(r.Context(), `SELECT row_to_json(t) FROM (SELECT * FROM challenges WHERE id = $1::uuid) t`, id)
	var raw []byte
	if err := row.Scan(&raw); err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "invalid challenge json")
		return
	}
	normalizeGameIDsInAdminDetailMap(m)
	h.enrichChallengeHeroAdminMap(r.Context(), m)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(m)
}

func (h *Handler) patchChallenge(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	var patch map[string]any
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}
	ctx := r.Context()
	var staff *string
	if sid, ok := adminapi.StaffIDFromContext(ctx); ok {
		staff = &sid
	}
	if v, ok := patch["status"].(string); ok && v != "" {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET status = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["slug"].(string); ok {
		slug := strings.TrimSpace(v)
		if slug != "" {
			if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET slug = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, slug, staff); err != nil {
				adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
				return
			}
		}
	}
	if v, ok := patch["title"].(string); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET title = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["description"].(string); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET description = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["rules"].(string); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET rules = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["terms"].(string); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET terms = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["prize_manual_review"].(bool); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET prize_manual_review = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["target_multiplier"]; ok && v != nil {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET target_multiplier = $2::numeric, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["prize_amount_minor"]; ok && v != nil {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET prize_amount_minor = $2::bigint, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["target_wager_amount_minor"]; ok && v != nil {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET target_wager_amount_minor = $2::bigint, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["challenge_type"].(string); ok && v != "" {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET challenge_type = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["min_bet_amount_minor"]; ok && v != nil {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET min_bet_amount_minor = $2::bigint, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["max_bet_amount_minor"]; ok && v != nil {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET max_bet_amount_minor = $2::bigint, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["starts_at"].(string); ok && strings.TrimSpace(v) != "" {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET starts_at = $2::timestamptz, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, strings.TrimSpace(v), staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["ends_at"].(string); ok && strings.TrimSpace(v) != "" {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET ends_at = $2::timestamptz, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, strings.TrimSpace(v), staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := jsonInt64FromMap(patch, "max_winners"); ok && v > 0 {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET max_winners = $2::int, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, int(v), staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["prize_currency"].(string); ok && strings.TrimSpace(v) != "" {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET prize_currency = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, strings.TrimSpace(v), staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if raw, has := patch["game_ids"]; has {
		ids := parseGameIDSlice(raw)
		if ids == nil {
			// JSON null, or a shape we cannot decode — do not overwrite stored game_ids (nil slice would NULL the column).
		} else if len(ids) == 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "validation", "at least one qualifying game is required")
			return
		} else {
			if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET game_ids = $2::text[], updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, ids, staff); err != nil {
				adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
				return
			}
		}
	}
	if raw, ok := patch["hero_image_url"]; ok {
		var in string
		var valid bool
		if raw == nil {
			in = ""
			valid = true
		} else if s, isStr := raw.(string); isStr {
			in = s
			valid = true
		}
		if valid {
			imageBase := ""
			if h.Cfg != nil {
				imageBase = strings.TrimSpace(h.Cfg.BlueOceanImageBaseURL)
			}
			v := strings.TrimSpace(blueocean.NormalizeCatalogImageURL(strings.TrimSpace(in), imageBase))
			if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET hero_image_url = NULLIF(trim($2),''), updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
				adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
				return
			}
		}
	}
	if v, ok := patch["badge_label"].(string); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET badge_label = NULLIF(trim($2),''), updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["is_featured"].(bool); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET is_featured = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["vip_only"].(bool); ok {
		if !v {
			if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET vip_only = false, vip_tier_minimum = NULL, updated_by = $2::uuid, updated_at = now() WHERE id = $1::uuid`, id, staff); err != nil {
				adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
				return
			}
		} else {
			if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET vip_only = true, updated_by = $2::uuid, updated_at = now() WHERE id = $1::uuid`, id, staff); err != nil {
				adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
				return
			}
		}
	}
	if v, ok := patch["vip_tier_minimum"].(string); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET vip_tier_minimum = NULLIF(trim($2),''), updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	} else if n, ok := jsonInt64FromMap(patch, "vip_tier_minimum"); ok && n > 0 {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET vip_tier_minimum = $2, updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, strconv.FormatInt(n, 10), staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	if v, ok := patch["prize_payout_asset_key"].(string); ok {
		if _, err := h.Pool.Exec(ctx, `UPDATE challenges SET prize_payout_asset_key = NULLIF(trim($2),''), updated_by = $3::uuid, updated_at = now() WHERE id = $1::uuid`, id, v, staff); err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) listChallengeEntries(w http.ResponseWriter, r *http.Request) {
	cid := strings.TrimSpace(chi.URLParam(r, "id"))
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, user_id::text, status, qualifying_bets, total_wagered_minor, risk_score, flagged_for_review, entered_at
		FROM challenge_entries WHERE challenge_id = $1::uuid ORDER BY entered_at DESC LIMIT 1000
	`, cid)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var eid, uid, st string
		var qb int
		var tw int64
		var rs float64
		var flagged bool
		var entered time.Time
		if err := rows.Scan(&eid, &uid, &st, &qb, &tw, &rs, &flagged, &entered); err != nil {
			continue
		}
		m := map[string]any{
			"id": eid, "user_id": uid, "status": st, "qualifying_bets": qb, "total_wagered_minor": tw,
			"risk_score": rs, "flagged_for_review": flagged, "entered_at": entered.UTC().Format(time.RFC3339),
		}
		list = append(list, m)
	}
	writeJSON(w, map[string]any{"entries": list})
}

func (h *Handler) patchChallengeEntry(w http.ResponseWriter, r *http.Request) {
	cid := strings.TrimSpace(chi.URLParam(r, "id"))
	eid := strings.TrimSpace(chi.URLParam(r, "eid"))
	var patch map[string]any
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_json", "invalid json")
		return
	}
	if st, ok := patch["status"].(string); ok && st == "disqualified" {
		_, err := h.Pool.Exec(r.Context(), `
			UPDATE challenge_entries SET status = 'disqualified', updated_at = now()
			WHERE id = $1::uuid AND challenge_id = $2::uuid
		`, eid, cid)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	if clear, ok := patch["clear_flags"].(bool); ok && clear {
		_, err := h.Pool.Exec(r.Context(), `
			UPDATE challenge_entries SET flagged_for_review = false, flag_reasons = '{}', updated_at = now()
			WHERE id = $1::uuid AND challenge_id = $2::uuid
		`, eid, cid)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "update_failed", err.Error())
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	adminapi.WriteError(w, http.StatusBadRequest, "no_action", "unsupported patch")
}

func (h *Handler) postAwardEntry(w http.ResponseWriter, r *http.Request) {
	cid := strings.TrimSpace(chi.URLParam(r, "id"))
	eid := strings.TrimSpace(chi.URLParam(r, "eid"))
	var uid string
	err := h.Pool.QueryRow(r.Context(), `SELECT user_id::text FROM challenge_entries WHERE id = $1::uuid AND challenge_id = $2::uuid`, eid, cid).Scan(&uid)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "entry not found")
		return
	}
	if err := challenges.AwardPrizeIfNeeded(r.Context(), h.Pool, eid, cid, uid, true); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "award_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
