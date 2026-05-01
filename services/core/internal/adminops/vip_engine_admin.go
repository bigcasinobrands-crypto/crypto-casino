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
)

func (h *Handler) listVIPDeliveryRuns(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	rows, err := bonus.ListVIPDeliveryRuns(r.Context(), h.Pool, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "runs query failed")
		return
	}
	writeJSON(w, map[string]any{"runs": rows})
}

type vipBroadcastBody struct {
	TierID int    `json:"tier_id"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	DryRun bool   `json:"dry_run"`
}

func (h *Handler) vipBroadcastMessage(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body vipBroadcastBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if body.TierID <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "tier_id required")
		return
	}
	title := strings.TrimSpace(body.Title)
	msg := strings.TrimSpace(body.Body)
	if title == "" || msg == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "title and body required")
		return
	}
	n, err := bonus.BroadcastVIPTierMessage(r.Context(), h.Pool, body.TierID, title, msg, body.DryRun)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "broadcast failed")
		return
	}
	meta, _ := json.Marshal(map[string]any{"tier_id": body.TierID, "dry_run": body.DryRun, "recipients": n})
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.broadcast_message', 'player_notifications', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true, "recipients": n, "dry_run": body.DryRun})
}

func (h *Handler) vipBroadcastPreview(w http.ResponseWriter, r *http.Request) {
	tierID, err := strconv.Atoi(r.URL.Query().Get("tier_id"))
	if err != nil || tierID <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "tier_id required")
		return
	}
	n, err := bonus.PreviewVIPTierAudience(r.Context(), h.Pool, tierID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "preview failed")
		return
	}
	writeJSON(w, map[string]any{"tier_id": tierID, "recipients": n})
}

func (h *Handler) adminVIPIdempotencyTrace(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "q required")
		return
	}
	ctx := r.Context()
	var bid, uid, st, idem string
	var pvid int64
	var ct time.Time
	err := h.Pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, promotion_version_id, status, idempotency_key, created_at
		FROM user_bonus_instances WHERE idempotency_key = $1
	`, q).Scan(&bid, &uid, &pvid, &st, &idem, &ct)
	if err == nil {
		writeJSON(w, map[string]any{
			"source": "user_bonus_instances",
			"row": map[string]any{
				"id": bid, "user_id": uid, "promotion_version_id": pvid,
				"status": st, "idempotency_key": idem, "created_at": ct.UTC().Format(time.RFC3339),
			},
		})
		return
	}
	var gid int64
	var tierID, benefitID int64
	var res, detail string
	err = h.Pool.QueryRow(ctx, `
		SELECT id, user_id::text, tier_id, benefit_id, COALESCE(promotion_version_id, 0), result, COALESCE(detail, ''), created_at
		FROM vip_tier_grant_log WHERE idempotency_key = $1
	`, q).Scan(&gid, &uid, &tierID, &benefitID, &pvid, &res, &detail, &ct)
	if err == nil {
		writeJSON(w, map[string]any{
			"source": "vip_tier_grant_log",
			"row": map[string]any{
				"id": gid, "user_id": uid, "tier_id": tierID, "benefit_id": benefitID,
				"promotion_version_id": pvid,
				"result": res, "detail": detail, "created_at": ct.UTC().Format(time.RFC3339),
			},
		})
		return
	}
	var rid, pipe string
	var amt *int64
	err = h.Pool.QueryRow(ctx, `
		SELECT run_id::text, user_id::text, pipeline, result, amount_minor, created_at
		FROM vip_delivery_run_items WHERE idempotency_key = $1
	`, q).Scan(&rid, &uid, &pipe, &res, &amt, &ct)
	if err == nil {
		writeJSON(w, map[string]any{
			"source": "vip_delivery_run_items",
			"row": map[string]any{
				"run_id": rid, "user_id": uid, "pipeline": pipe, "result": res,
				"amount_minor": amt, "created_at": ct.UTC().Format(time.RFC3339),
			},
		})
		return
	}
	writeJSON(w, map[string]any{"source": nil, "message": "no rows matched"})
}

func (h *Handler) getVIPPlayerSupportSnapshot(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "id")
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "id required")
		return
	}
	ctx := r.Context()
	out := map[string]any{"user_id": uid}
	var tierID *int
	var points, life int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT tier_id, points_balance, lifetime_wager_minor FROM player_vip_state WHERE user_id = $1::uuid
	`, uid).Scan(&tierID, &points, &life)
	out["points_balance"] = points
	out["lifetime_wager_minor"] = life
	if tierID != nil {
		out["tier_id"] = *tierID
	}
	ev, err := h.Pool.Query(ctx, `
		SELECT id, from_tier_id, to_tier_id, lifetime_wager_minor, created_at
		FROM vip_tier_events WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 10
	`, uid)
	if err == nil {
		defer ev.Close()
		var events []map[string]any
		for ev.Next() {
			var id int64
			var fromT, toT *int
			var lw int64
			var ct time.Time
			if err := ev.Scan(&id, &fromT, &toT, &lw, &ct); err != nil {
				continue
			}
			m := map[string]any{"id": id, "lifetime_wager_minor": lw, "created_at": ct.UTC().Format(time.RFC3339)}
			if fromT != nil {
				m["from_tier_id"] = *fromT
			}
			if toT != nil {
				m["to_tier_id"] = *toT
			}
			events = append(events, m)
		}
		out["recent_tier_events"] = events
	}
	gl, err := h.Pool.Query(ctx, `
		SELECT id, tier_id, benefit_id, result, idempotency_key, created_at
		FROM vip_tier_grant_log WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 20
	`, uid)
	if err == nil {
		defer gl.Close()
		var grants []map[string]any
		for gl.Next() {
			var id, grTierID, bid int64
			var res, idem string
			var ct time.Time
			if err := gl.Scan(&id, &grTierID, &bid, &res, &idem, &ct); err != nil {
				continue
			}
			grants = append(grants, map[string]any{
				"id": id, "tier_id": grTierID, "benefit_id": bid, "result": res,
				"idempotency_key": idem, "created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		out["recent_tier_grants"] = grants
	}
	di, err := h.Pool.Query(ctx, `
		SELECT pipeline, result, idempotency_key, amount_minor, created_at
		FROM vip_delivery_run_items WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 20
	`, uid)
	if err == nil {
		defer di.Close()
		var items []map[string]any
		for di.Next() {
			var pipe, res, idem string
			var amt *int64
			var ct time.Time
			if err := di.Scan(&pipe, &res, &idem, &amt, &ct); err != nil {
				continue
			}
			items = append(items, map[string]any{
				"pipeline": pipe, "result": res, "idempotency_key": idem,
				"amount_minor": amt, "created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		out["recent_delivery_items"] = items
	}
	writeJSON(w, out)
}

func (h *Handler) getHuntConfigAdmin(w http.ResponseWriter, r *http.Request) {
	j, err := bonus.HuntProgramAdminJSON(r.Context(), h.Pool)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "hunt config failed")
		return
	}
	writeJSON(w, j)
}

type putHuntConfigBody struct {
	Config  json.RawMessage `json:"config"`
	Enabled *bool           `json:"enabled,omitempty"`
}

func (h *Handler) putHuntConfigAdmin(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body putHuntConfigBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if err := bonus.UpdateDailyHuntProgramConfig(r.Context(), h.Pool, body.Config); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_config", err.Error())
		return
	}
	if body.Enabled != nil {
		_, _ = h.Pool.Exec(r.Context(), `
			UPDATE reward_programs
			SET enabled = $1, updated_at = now()
			WHERE kind = $2
		`, *body.Enabled, bonus.RewardKindDailyHunt)
	}
	meta, _ := json.Marshal(map[string]any{"action": "vip.hunt_config_patch"})
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'vip.hunt_config', 'reward_programs', $2::jsonb)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}
