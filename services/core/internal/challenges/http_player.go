package challenges

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/privacy"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MountPlayer registers /v1/challenges* routes (caller mounts under /v1).
// catalogImageBase is BLUEOCEAN_IMAGE_BASE_URL (or equivalent) for resolving relative game thumbnails.
// accessCookieName is set to playercookies.AccessCookieName when PLAYER_COOKIE_AUTH is enabled.
func MountPlayer(r chi.Router, pool *pgxpool.Pool, iss *jwtissuer.Issuer, rev *jtiredis.Revoker, catalogImageBase string, accessCookieName string) {
	r.Route("/challenges", func(sr chi.Router) {
		sr.With(playerapi.BearerMiddleware(iss, rev, accessCookieName)).Get("/me/list", myChallengesHandler(pool))
		sr.With(playerapi.OptionalBearerMiddleware(iss, rev, accessCookieName)).Get("/", listChallengesHandler(pool, catalogImageBase))
		sr.With(playerapi.OptionalBearerMiddleware(iss, rev, accessCookieName)).Get("/by-slug/{slug}", getChallengeBySlugHandler(pool, catalogImageBase))
		sr.With(playerapi.BearerMiddleware(iss, rev, accessCookieName)).Post("/{id}/claim", claimHandler(pool))
		sr.With(playerapi.BearerMiddleware(iss, rev, accessCookieName)).Get("/{id}/entry", myEntryHandler(pool))
		sr.With(playerapi.OptionalBearerMiddleware(iss, rev, accessCookieName)).Get("/{id}/leaderboard", leaderboardHandler(pool))
		sr.With(playerapi.BearerMiddleware(iss, rev, accessCookieName)).Post("/{id}/enter", enterHandler(pool))
		sr.With(playerapi.OptionalBearerMiddleware(iss, rev, accessCookieName)).Get("/{id}", getChallengeHandler(pool, catalogImageBase))
	})
}

func writePlayerJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func scanChallengeListRow(rows pgx.Rows) (map[string]any, error) {
	var id, slug, title, desc, ctype, status, prizeType, currency string
	var hero, badge *string
	var minBet, maxWinners, winners int64
	var maxBet, targetWager, prizeMinor *int64
	var tgtMult *float64
	var starts, ends time.Time
	var gameIDs []string
	var featured bool
	var disp int
	var reqClaim, prizeManual bool
	var vipOnly bool
	var vipMin, payoutKey *string
	err := rows.Scan(&id, &slug, &title, &desc, &ctype, &status, &hero, &badge, &minBet, &maxBet, &tgtMult, &targetWager, &prizeType, &prizeMinor, &currency, &maxWinners, &winners, &starts, &ends, &gameIDs, &featured, &disp, &reqClaim, &prizeManual, &vipOnly, &vipMin, &payoutKey)
	if err != nil {
		return nil, err
	}
	m := map[string]any{
		"id": id, "slug": slug, "title": title, "description": desc, "challenge_type": ctype,
		"status": status, "min_bet_amount_minor": minBet, "prize_type": prizeType, "prize_currency": currency,
		"max_winners": maxWinners, "winners_so_far": winners, "starts_at": starts.UTC().Format(time.RFC3339),
		"ends_at": ends.UTC().Format(time.RFC3339), "is_featured": featured, "display_order": disp,
		"require_claim_for_prize": reqClaim, "prize_manual_review": prizeManual,
		"vip_only": vipOnly,
	}
	if vipMin != nil && strings.TrimSpace(*vipMin) != "" {
		m["vip_tier_minimum"] = strings.TrimSpace(*vipMin)
	}
	if payoutKey != nil && strings.TrimSpace(*payoutKey) != "" {
		m["prize_payout_asset_key"] = strings.TrimSpace(*payoutKey)
	}
	if hero != nil {
		m["hero_image_url"] = *hero
	}
	if badge != nil {
		m["badge_label"] = *badge
	}
	if maxBet != nil {
		m["max_bet_amount_minor"] = *maxBet
	}
	if tgtMult != nil {
		m["target_multiplier"] = *tgtMult
	}
	if targetWager != nil {
		m["target_wager_amount_minor"] = *targetWager
	}
	if prizeMinor != nil {
		m["prize_amount_minor"] = *prizeMinor
	}
	if len(gameIDs) > 0 {
		m["game_ids"] = gameIDs
	}
	return m, nil
}

func gameIDsTrimmedFromChallengeMap(c map[string]any) []string {
	raw, ok := c["game_ids"].([]string)
	if !ok || len(raw) == 0 {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, s := range raw {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// challengeMatchesGameFilter verifies challenge game_ids resolve to the same games row as gameFilter (id or id_hash).
func challengeMatchesGameFilter(ctx context.Context, pool *pgxpool.Pool, gameFilter string, c map[string]any) bool {
	gameFilter = strings.TrimSpace(gameFilter)
	if gameFilter == "" {
		return true
	}
	ids := gameIDsTrimmedFromChallengeMap(c)
	if len(ids) == 0 {
		return false
	}
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM unnest($1::text[]) AS gref(gid)
			WHERE TRIM(BOTH FROM gid::text) <> ''
			  AND (
				TRIM(BOTH FROM gid::text) = $2
				OR EXISTS (
					SELECT 1 FROM games g
					WHERE (g.id = $2 OR (g.id_hash IS NOT NULL AND g.id_hash <> '' AND g.id_hash = $2))
					  AND (
						g.id = TRIM(BOTH FROM gref.gid::text)
						OR (g.id_hash IS NOT NULL AND g.id_hash <> '' AND g.id_hash = TRIM(BOTH FROM gref.gid::text))
					  )
				)
			  )
		)
	`, ids, gameFilter).Scan(&ok)
	return err == nil && ok
}

func listChallengesHandler(pool *pgxpool.Pool, catalogImageBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		_ = PromoteAllDueScheduledChallenges(ctx, pool)
		uid, _ := playerapi.UserIDFromContext(ctx)
		gameFilter := strings.TrimSpace(r.URL.Query().Get("game_id"))
		rows, err := pool.Query(ctx, `
			SELECT id::text, slug, title, description, challenge_type, status, hero_image_url, badge_label,
			       min_bet_amount_minor, max_bet_amount_minor, target_multiplier, target_wager_amount_minor,
			       prize_type, prize_amount_minor, prize_currency, max_winners, winners_count, starts_at, ends_at,
			       game_ids, is_featured, display_order, require_claim_for_prize, prize_manual_review,
			       vip_only, vip_tier_minimum, prize_payout_asset_key
			FROM challenges
			WHERE status IN ('active', 'scheduled')
			  AND (status = 'active' AND now() < ends_at OR status = 'scheduled')
			  AND (
				$1::text = ''
				OR (
					COALESCE(array_length(game_ids, 1), 0) > 0
					AND EXISTS (
						SELECT 1
						FROM unnest(game_ids) AS gref(gid)
						WHERE TRIM(BOTH FROM gid::text) <> ''
						  AND (
							TRIM(BOTH FROM gid::text) = $1
							OR EXISTS (
								SELECT 1 FROM games g
								WHERE (g.id = $1 OR (g.id_hash IS NOT NULL AND g.id_hash <> '' AND g.id_hash = $1))
								  AND (
									g.id = TRIM(BOTH FROM gref.gid::text)
									OR (g.id_hash IS NOT NULL AND g.id_hash <> '' AND g.id_hash = TRIM(BOTH FROM gref.gid::text))
								  )
							)
						  )
					)
				)
			  )
			ORDER BY display_order ASC, starts_at ASC
			LIMIT 100
		`, gameFilter)
		if err != nil {
			log.Printf("challenges list: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "Could not load challenges.")
			return
		}
		defer rows.Close()
		var out []map[string]any
		for rows.Next() {
			c, err := scanChallengeListRow(rows)
			if err != nil {
				continue
			}
			var minPtr *string
			if s, ok := c["vip_tier_minimum"].(string); ok && strings.TrimSpace(s) != "" {
				v := strings.TrimSpace(s)
				minPtr = &v
			}
			vipO, _ := c["vip_only"].(bool)
			if err := VIPMeetsChallenge(ctx, pool, uid, vipO, minPtr); err != nil {
				continue
			}
			applyChallengeHeroToMap(ctx, pool, catalogImageBase, c)
			if uid != "" {
				applyMyEntry(ctx, pool, uid, c)
			}
			out = append(out, c)
		}
		if gameFilter != "" {
			filtered := out[:0]
			for _, c := range out {
				if challengeMatchesGameFilter(ctx, pool, gameFilter, c) {
					filtered = append(filtered, c)
				}
			}
			out = filtered
		}
		writePlayerJSON(w, http.StatusOK, map[string]any{"challenges": out})
	}
}

func applyMyEntry(ctx context.Context, pool *pgxpool.Pool, uid string, c map[string]any) {
	cid := c["id"].(string)
	var st string
	var prog float64
	var best *float64
	var tw int64
	var qb int
	var pam *int64
	var awardedAt sql.NullTime
	err := pool.QueryRow(ctx, `
		SELECT status, COALESCE(progress_value, 0)::float8, best_multiplier, total_wagered_minor, qualifying_bets, prize_awarded_minor, prize_awarded_at
		FROM challenge_entries WHERE challenge_id = $1::uuid AND user_id = $2::uuid
	`, cid, uid).Scan(&st, &prog, &best, &tw, &qb, &pam, &awardedAt)
	if err != nil {
		return
	}
	me := map[string]any{"status": st, "progress_value": prog, "total_wagered_minor": tw, "qualifying_bets": qb}
	if best != nil {
		me["best_multiplier"] = *best
	}
	if pam != nil {
		me["prize_awarded_minor"] = *pam
	}
	if awardedAt.Valid {
		me["prize_awarded_at"] = awardedAt.Time.UTC().Format(time.RFC3339)
	}
	ptype, _ := c["prize_type"].(string)
	pt := strings.TrimSpace(strings.ToLower(ptype))
	reqClaim, _ := c["require_claim_for_prize"].(bool)
	manual, _ := c["prize_manual_review"].(bool)
	canClaim := st == "completed" && !manual && reqClaim && !awardedAt.Valid &&
		(pt == "cash" || pt == "bonus" || pt == "free_spins")
	me["can_claim_prize"] = canClaim
	c["my_entry"] = me
}

func getChallengeHandler(pool *pgxpool.Pool, catalogImageBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(chi.URLParam(r, "id"))
		ctx := r.Context()
		_ = PromoteScheduledChallengeIfDue(ctx, pool, id)
		row := pool.QueryRow(ctx, `
			SELECT id::text, slug, title, description, rules, terms, challenge_type, status, hero_image_url, badge_label,
			       min_bet_amount_minor, max_bet_amount_minor, target_multiplier, target_wager_amount_minor,
			       prize_type, prize_amount_minor, prize_currency, max_winners, winners_count, starts_at, ends_at,
			       game_ids, is_featured, display_order, require_claim_for_prize, prize_manual_review,
			       vip_only, vip_tier_minimum, prize_payout_asset_key,
			       COALESCE(prize_wagering_multiplier, 0), prize_free_spins, prize_free_spin_game_id,
			       COALESCE(prize_bet_per_round_minor, 1)
			FROM challenges WHERE id = $1::uuid
		`, id)
		c, err := scanChallengeDetailRow(row)
		if err != nil || c == nil {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "challenge not found")
			return
		}
		applyChallengeHeroToMap(ctx, pool, catalogImageBase, c)
		if uid, ok := playerapi.UserIDFromContext(ctx); ok {
			applyMyEntry(ctx, pool, uid, c)
		}
		writePlayerJSON(w, http.StatusOK, c)
	}
}

func scanChallengeDetailRow(row pgx.Row) (map[string]any, error) {
	var id, slug, title, desc, rules, terms, ctype, status, prizeType, currency string
	var hero, badge *string
	var minBet, maxWinners, winners int64
	var maxBet, targetWager, prizeMinor *int64
	var tgtMult *float64
	var starts, ends time.Time
	var gameIDs []string
	var featured bool
	var disp int
	var reqClaim, prizeManual bool
	var vipOnly bool
	var vipMin, payoutKey *string
	var wrMult int
	var fsRounds sql.NullInt64
	var fsGame sql.NullString
	var fsBet int64
	if err := row.Scan(&id, &slug, &title, &desc, &rules, &terms, &ctype, &status, &hero, &badge, &minBet, &maxBet, &tgtMult, &targetWager, &prizeType, &prizeMinor, &currency, &maxWinners, &winners, &starts, &ends, &gameIDs, &featured, &disp, &reqClaim, &prizeManual, &vipOnly, &vipMin, &payoutKey, &wrMult, &fsRounds, &fsGame, &fsBet); err != nil {
		return nil, err
	}
	m := map[string]any{
		"id": id, "slug": slug, "title": title, "description": desc, "rules": rules, "terms": terms,
		"challenge_type": ctype, "status": status, "min_bet_amount_minor": minBet,
		"prize_type": prizeType, "prize_currency": currency, "max_winners": maxWinners, "winners_so_far": winners,
		"starts_at": starts.UTC().Format(time.RFC3339), "ends_at": ends.UTC().Format(time.RFC3339),
		"is_featured": featured, "display_order": disp,
		"require_claim_for_prize": reqClaim, "prize_manual_review": prizeManual,
		"vip_only": vipOnly,
	}
	if vipMin != nil && strings.TrimSpace(*vipMin) != "" {
		m["vip_tier_minimum"] = strings.TrimSpace(*vipMin)
	}
	if payoutKey != nil && strings.TrimSpace(*payoutKey) != "" {
		m["prize_payout_asset_key"] = strings.TrimSpace(*payoutKey)
	}
	if hero != nil {
		m["hero_image_url"] = *hero
	}
	if badge != nil {
		m["badge_label"] = *badge
	}
	if maxBet != nil {
		m["max_bet_amount_minor"] = *maxBet
	}
	if tgtMult != nil {
		m["target_multiplier"] = *tgtMult
	}
	if targetWager != nil {
		m["target_wager_amount_minor"] = *targetWager
	}
	if prizeMinor != nil {
		m["prize_amount_minor"] = *prizeMinor
	}
	if wrMult > 0 {
		m["prize_wagering_multiplier"] = wrMult
	}
	if fsRounds.Valid && fsRounds.Int64 > 0 {
		m["prize_free_spins"] = fsRounds.Int64
	}
	if fsGame.Valid && strings.TrimSpace(fsGame.String) != "" {
		m["prize_free_spin_game_id"] = strings.TrimSpace(fsGame.String)
	}
	if fsBet > 0 {
		m["prize_bet_per_round_minor"] = fsBet
	}
	if len(gameIDs) > 0 {
		m["game_ids"] = gameIDs
	}
	return m, nil
}

func getChallengeBySlugHandler(pool *pgxpool.Pool, catalogImageBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := strings.TrimSpace(chi.URLParam(r, "slug"))
		ctx := r.Context()
		_ = PromoteAllDueScheduledChallenges(ctx, pool)
		row := pool.QueryRow(ctx, `
			SELECT id::text, slug, title, description, rules, terms, challenge_type, status, hero_image_url, badge_label,
			       min_bet_amount_minor, max_bet_amount_minor, target_multiplier, target_wager_amount_minor,
			       prize_type, prize_amount_minor, prize_currency, max_winners, winners_count, starts_at, ends_at,
			       game_ids, is_featured, display_order, require_claim_for_prize, prize_manual_review,
			       vip_only, vip_tier_minimum, prize_payout_asset_key,
			       COALESCE(prize_wagering_multiplier, 0), prize_free_spins, prize_free_spin_game_id,
			       COALESCE(prize_bet_per_round_minor, 1)
			FROM challenges WHERE lower(slug) = lower($1)
		`, slug)
		c, err := scanChallengeDetailRow(row)
		if err != nil || c == nil {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "challenge not found")
			return
		}
		applyChallengeHeroToMap(ctx, pool, catalogImageBase, c)
		if uid, ok := playerapi.UserIDFromContext(ctx); ok {
			applyMyEntry(ctx, pool, uid, c)
		}
		writePlayerJSON(w, http.StatusOK, c)
	}
}

func enterHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		id := strings.TrimSpace(chi.URLParam(r, "id"))
		var body struct {
			AcceptTerms       bool   `json:"accept_terms"`
			DeviceFingerprint string `json:"device_fingerprint"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !body.AcceptTerms {
			playerapi.WriteError(w, http.StatusBadRequest, "terms_required", "must accept terms")
			return
		}
		ip := r.RemoteAddr
		if x := r.Header.Get("X-Forwarded-For"); x != "" {
			ip = strings.TrimSpace(strings.Split(x, ",")[0])
		}
		err := TryEnter(r.Context(), pool, uid, id, ip, body.DeviceFingerprint)
		if err != nil {
			switch {
			case errors.Is(err, ErrAlreadyEntered):
				playerapi.WriteError(w, http.StatusConflict, "already_entered", "You are already entered in this challenge.")
			case errors.Is(err, ErrSelfExcluded):
				playerapi.WriteError(w, http.StatusForbidden, "self_excluded", "Play is not available for your account.")
			case errors.Is(err, ErrVIPNotEligible):
				playerapi.WriteError(w, http.StatusForbidden, "vip_tier_required", "This challenge requires a higher VIP tier.")
			case errors.Is(err, ErrChallengeNotEnterable):
				playerapi.WriteError(w, http.StatusBadRequest, "not_enterable", "This challenge cannot be joined right now.")
			default:
				log.Printf("challenge enter: %v", err)
				playerapi.WriteError(w, http.StatusBadRequest, "enter_failed", "Could not join this challenge.")
			}
			return
		}
		writePlayerJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func claimHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		id := strings.TrimSpace(chi.URLParam(r, "id"))
		if err := ClaimPrize(r.Context(), pool, uid, id); err != nil {
			log.Printf("challenge claim: %v", err)
			playerapi.WriteError(w, http.StatusBadRequest, "claim_failed", "Could not complete this claim.")
			return
		}
		writePlayerJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func myEntryHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		id := strings.TrimSpace(chi.URLParam(r, "id"))
		var eid, cid, st string
		var prog float64
		var best *float64
		var qb int
		var tw int64
		var pam *int64
		var completed *time.Time
		err := pool.QueryRow(r.Context(), `
			SELECT id::text, challenge_id::text, status, COALESCE(progress_value,0)::float8,
			       best_multiplier, qualifying_bets, total_wagered_minor, prize_awarded_minor, completed_at
			FROM challenge_entries WHERE challenge_id = $1::uuid AND user_id = $2::uuid
		`, id, uid).Scan(&eid, &cid, &st, &prog, &best, &qb, &tw, &pam, &completed)
		if err != nil {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "no entry")
			return
		}
		out := map[string]any{
			"id": eid, "challenge_id": cid, "status": st, "progress_value": prog,
			"qualifying_bets": qb, "total_wagered_minor": tw,
		}
		if best != nil {
			out["best_multiplier"] = *best
		}
		if pam != nil {
			out["prize_awarded_minor"] = *pam
		}
		if completed != nil {
			out["completed_at"] = completed.UTC().Format(time.RFC3339)
		}
		writePlayerJSON(w, http.StatusOK, map[string]any{"entry": out})
	}
}

// leaderboardPublicBaseLabel is the readable label before privacy masking for other viewers.
func leaderboardPublicBaseLabel(viewerUID, entryUID, username, email, maskedEmail string) string {
	u := strings.TrimSpace(username)
	if u != "" {
		return u
	}
	if viewerUID != "" && viewerUID == entryUID {
		e := strings.TrimSpace(email)
		if i := strings.IndexByte(e, '@'); i > 0 {
			return e[:i]
		}
		if e != "" {
			return e
		}
	}
	return maskedEmail
}

func leaderboardHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(chi.URLParam(r, "id"))
		ctx := r.Context()
		viewerUID, _ := playerapi.UserIDFromContext(ctx)
		viewerUID = strings.TrimSpace(viewerUID)
		var ctype string
		if err := pool.QueryRow(ctx, `SELECT challenge_type FROM challenges WHERE id = $1::uuid`, id).Scan(&ctype); err != nil {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "challenge not found")
			return
		}
		rows, err := pool.Query(ctx, `
			SELECT e.user_id::text,
			       CASE WHEN length(trim(COALESCE(u.email,''))) >= 3 THEN substring(trim(u.email) from 1 for 3) || '***' ELSE '***' END,
			       COALESCE(e.best_multiplier, 0)::float8,
			       COALESCE(e.progress_value, 0)::float8,
			       e.total_wagered_minor, e.status,
			       CASE WHEN c.challenge_type = 'wager_volume' THEN
			         COALESCE(
			           (SELECT MAX(cbe.settled_at) FROM challenge_bet_events cbe WHERE cbe.entry_id = e.id),
			           e.updated_at
			         )
			       ELSE
			         COALESCE(
			           (
			             SELECT cbe.settled_at
			             FROM challenge_bet_events cbe
			             WHERE cbe.entry_id = e.id
			               AND e.best_multiplier IS NOT NULL
			               AND e.best_multiplier > 0
			               AND cbe.multiplier = e.best_multiplier
			             ORDER BY cbe.settled_at DESC
			             LIMIT 1
			           ),
			           e.updated_at
			         )
			       END AS leaderboard_at,
			       trim(both from COALESCE(u.avatar_url, '')) AS leaderboard_avatar_url,
			       u.public_participant_id::text AS leaderboard_participant_id,
			       trim(both from COALESCE(u.username, '')) AS leaderboard_username,
			       trim(both from COALESCE(u.email, '')) AS leaderboard_email,
			       (
			         COALESCE(u.preferences, '{}'::jsonb) @> jsonb_build_object($2::text, true)
			         OR lower(trim(COALESCE(u.preferences->>$2, ''))) IN ('true', '1', 'yes')
			       ) AS wants_public_anon
			FROM challenge_entries e
			JOIN users u ON u.id = e.user_id
			JOIN challenges c ON c.id = e.challenge_id
			WHERE e.challenge_id = $1::uuid AND e.status IN ('active', 'completed')
			ORDER BY
				CASE WHEN c.challenge_type = 'wager_volume' THEN e.total_wagered_minor ELSE COALESCE(e.best_multiplier, 0) END DESC,
				CASE WHEN c.challenge_type = 'wager_volume' THEN COALESCE(e.best_multiplier, 0) ELSE e.total_wagered_minor END DESC
			LIMIT 50
		`, id, privacy.PrefAnonymisePublicName)
		if err != nil {
			log.Printf("challenge leaderboard: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "Could not load leaderboard.")
			return
		}
		defer rows.Close()
		var list []map[string]any
		rank := 0
		for rows.Next() {
			rank++
			var uid, masked, st, avatarURL, participantID, lbUser, lbEmail string
			var bm, prog float64
			var tw int64
			var lbAt time.Time
			var wantsAnon bool
			if err := rows.Scan(&uid, &masked, &bm, &prog, &tw, &st, &lbAt, &avatarURL, &participantID, &lbUser, &lbEmail, &wantsAnon); err != nil {
				continue
			}
			base := leaderboardPublicBaseLabel(viewerUID, uid, lbUser, lbEmail, masked)
			label := base
			if wantsAnon {
				label = privacy.MaskMiddlePublicHandle(base)
			}
			row := map[string]any{
				"rank":                rank,
				"player_label":        label,
				"best_multiplier":     bm,
				"progress":            prog,
				"total_wagered_minor": tw,
				"status":              st,
				"achieved_at":         lbAt.UTC().Format(time.RFC3339),
			}
			if strings.TrimSpace(avatarURL) != "" && strings.TrimSpace(participantID) != "" {
				row["avatar_url"] = privacy.PlayerVisibleAvatarURL(strings.TrimSpace(avatarURL), strings.TrimSpace(participantID))
			}
			if viewerUID != "" && viewerUID == uid {
				row["is_viewer"] = true
			}
			list = append(list, row)
		}
		writePlayerJSON(w, http.StatusOK, map[string]any{"challenge_type": ctype, "leaderboard": list})
	}
}

func myChallengesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		rows, err := pool.Query(r.Context(), `
			SELECT c.id::text, c.slug, c.title, c.challenge_type, c.status, e.status AS entry_status,
			       COALESCE(e.progress_value,0)::float8, e.completed_at IS NOT NULL AS done
			FROM challenge_entries e
			JOIN challenges c ON c.id = e.challenge_id
			WHERE e.user_id = $1::uuid
			ORDER BY e.entered_at DESC
			LIMIT 100
		`, uid)
		if err != nil {
			log.Printf("challenge my list: %v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "Could not load your challenges.")
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var cid, slug, title, ctype, cst, est string
			var prog float64
			var done bool
			if err := rows.Scan(&cid, &slug, &title, &ctype, &cst, &est, &prog, &done); err != nil {
				continue
			}
			list = append(list, map[string]any{
				"id": cid, "slug": slug, "title": title, "challenge_type": ctype, "challenge_status": cst,
				"entry_status": est, "progress_value": prog, "completed": done,
			})
		}
		writePlayerJSON(w, http.StatusOK, map[string]any{"entries": list})
	}
}
