package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/raffle"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) mountRaffles(r chi.Router) {
	r.Get("/raffles/settings", h.getRaffleSettingsAdmin)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/raffles/settings", h.patchRaffleSettingsAdmin)
	r.Get("/raffles", h.listRafflesAdmin)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/raffles", h.postRaffleCampaign)
	r.Get("/raffles/{id}", h.getRaffleAdmin)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/raffles/{id}", h.patchRaffleCampaign)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/raffles/{id}/lock-draw", h.postRaffleLockDraw)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/raffles/{id}/run-draw", h.postRaffleRunDraw)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/raffles/{id}/publish-winners", h.postRafflePublishWinners)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/raffles/{id}/payout-winners", h.postRafflePayoutWinners)
}

func (h *Handler) listRafflesAdmin(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, slug, title, status, visibility, start_at, end_at, draw_at, completed_at, updated_at
		FROM raffle_campaigns ORDER BY updated_at DESC LIMIT 100
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, slug, title, status, vis string
		var start, end, draw, done, upd interface{}
		if err := rows.Scan(&id, &slug, &title, &status, &vis, &start, &end, &draw, &done, &upd); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "slug": slug, "title": title, "status": status, "visibility": vis,
			"start_at": start, "end_at": end, "draw_at": draw, "completed_at": done, "updated_at": upd,
		})
	}
	writeJSON(w, map[string]any{"campaigns": list})
}

func (h *Handler) getRaffleAdmin(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var rawBytes []byte
	err := h.Pool.QueryRow(r.Context(), `
		SELECT row_to_json(c)::jsonb FROM (
		  SELECT id::text, slug, title, description, image_url, status, visibility,
		    start_at, end_at, draw_at, completed_at,
		    eligible_products, eligible_currencies, ticket_rate_config,
		    purchase_enabled, purchase_config, max_tickets_per_user, max_tickets_global,
		    max_wins_per_user, terms_text, responsible_notice
		  FROM raffle_campaigns WHERE id = $1::uuid
		) c
	`).Scan(&rawBytes)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "campaign")
		return
	}
	var raw map[string]any
	if json.Unmarshal(rawBytes, &raw) != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "decode_failed", "campaign json")
		return
	}
	prows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, rank_order, prize_type, amount_minor, currency, winner_slots, auto_payout, requires_approval
		FROM raffle_prizes WHERE campaign_id = $1::uuid ORDER BY rank_order
	`, id)
	var prizes []map[string]any
	if err == nil {
		for prows.Next() {
			var pid string
			var ro int
			var pt, ccy string
			var amt int64
			var slots int
			var auto, apr bool
			if err := prows.Scan(&pid, &ro, &pt, &amt, &ccy, &slots, &auto, &apr); err != nil {
				continue
			}
			prizes = append(prizes, map[string]any{
				"id": pid, "rank_order": ro, "prize_type": pt, "amount_minor": amt, "currency": ccy,
				"winner_slots": slots, "auto_payout": auto, "requires_approval": apr,
			})
		}
		prows.Close()
	}
	writeJSON(w, map[string]any{"campaign": raw, "prizes": prizes})
}

type drawBody struct {
	DrawID string `json:"draw_id"`
}

func (h *Handler) postRaffleLockDraw(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	drawID, err := raffle.LockDraw(r.Context(), h.Pool, id, staff)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "lock_failed", err.Error())
		return
	}
	reason := "lock_draw"
	raffle.InsertAudit(r.Context(), h.Pool, &id, &staff, nil, "lock_draw", "raffle_draw", drawID, nil, map[string]any{"draw_id": drawID}, reason, raffleAdminReqIP(r), r.UserAgent())
	writeJSON(w, map[string]any{"draw_id": drawID})
}

func (h *Handler) postRaffleRunDraw(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	var body drawBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.DrawID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_draw_id", "draw_id required")
		return
	}
	if err := raffle.RunDraw(r.Context(), h.Pool, id, body.DrawID, staff); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "run_failed", err.Error())
		return
	}
	reason := "run_draw"
	raffle.InsertAudit(r.Context(), h.Pool, &id, &staff, nil, "run_draw", "raffle_draw", body.DrawID, nil, map[string]any{"draw_id": body.DrawID}, reason, raffleAdminReqIP(r), r.UserAgent())
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) postRafflePublishWinners(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	var body drawBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.DrawID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_draw_id", "draw_id required")
		return
	}
	if err := raffle.PublishWinners(r.Context(), h.Pool, id, body.DrawID, staff); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "publish_failed", err.Error())
		return
	}
	raffle.InsertAudit(r.Context(), h.Pool, &id, &staff, nil, "publish_winners", "raffle_draw", body.DrawID, nil, nil, "publish", raffleAdminReqIP(r), r.UserAgent())
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) postRafflePayoutWinners(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	var body drawBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.DrawID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_draw_id", "draw_id required")
		return
	}
	n, err := raffle.PayoutCampaignWinners(r.Context(), h.Pool, h.Cfg, id, body.DrawID)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "payout_failed", err.Error())
		return
	}
	raffle.InsertAudit(r.Context(), h.Pool, &id, &staff, nil, "payout_winners", "raffle_draw", body.DrawID, nil, map[string]any{"paid": n}, "payout", raffleAdminReqIP(r), r.UserAgent())
	writeJSON(w, map[string]any{"paid": n})
}

func raffleAdminReqIP(r *http.Request) string {
	if x := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); x != "" {
		return x
	}
	return strings.TrimSpace(r.RemoteAddr)
}
