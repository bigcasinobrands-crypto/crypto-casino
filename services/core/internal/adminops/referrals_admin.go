package adminops

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/affiliate"
	"github.com/go-chi/chi/v5"
)

// GET /v1/admin/referrals/tiers
func (h *Handler) listReferralProgramTiers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Pool.Query(ctx, `
		SELECT id, name, sort_order, active,
		       ngr_revshare_bps, first_deposit_cpa_minor, deposit_revshare_bps,
		       min_referred_signups, min_referred_depositors, min_referred_deposit_volume_minor,
		       created_at, updated_at
		FROM referral_program_tiers
		ORDER BY sort_order ASC, id ASC
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, sort int
		var name string
		var active bool
		var ngrBps, depBps sql.NullInt32
		var cpa sql.NullInt64
		var minS, minD sql.NullInt32
		var minVol sql.NullInt64
		var ca, ua sql.NullTime
		if err := rows.Scan(&id, &name, &sort, &active, &ngrBps, &cpa, &depBps, &minS, &minD, &minVol, &ca, &ua); err != nil {
			continue
		}
		m := map[string]any{
			"id": id, "name": name, "sort_order": sort, "active": active,
		}
		if ca.Valid {
			m["created_at"] = ca.Time.UTC().Format(time.RFC3339)
		}
		if ua.Valid {
			m["updated_at"] = ua.Time.UTC().Format(time.RFC3339)
		}
		if ngrBps.Valid {
			m["ngr_revshare_bps"] = ngrBps.Int32
		}
		if cpa.Valid {
			m["first_deposit_cpa_minor"] = cpa.Int64
		}
		if depBps.Valid {
			m["deposit_revshare_bps"] = depBps.Int32
		}
		if minS.Valid {
			m["min_referred_signups"] = minS.Int32
		}
		if minD.Valid {
			m["min_referred_depositors"] = minD.Int32
		}
		if minVol.Valid {
			m["min_referred_deposit_volume_minor"] = minVol.Int64
		}
		out = append(out, m)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"tiers": out})
}

type patchReferralTierBody struct {
	Name                            *string `json:"name"`
	SortOrder                       *int    `json:"sort_order"`
	Active                          *bool   `json:"active"`
	NGRRevshareBps                  *int    `json:"ngr_revshare_bps"`
	FirstDepositCPAMinor            *int64  `json:"first_deposit_cpa_minor"`
	DepositRevshareBps              *int    `json:"deposit_revshare_bps"`
	MinReferredSignups              *int    `json:"min_referred_signups"`
	MinReferredDepositors           *int    `json:"min_referred_depositors"`
	MinReferredDepositVolumeMinor   *int64  `json:"min_referred_deposit_volume_minor"`
}

// PATCH /v1/admin/referrals/tiers/{id}
func (h *Handler) patchReferralProgramTier(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sid := chi.URLParam(r, "id")
	id, err := strconv.Atoi(sid)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "invalid tier id")
		return
	}
	var body patchReferralTierBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	staffID, ok := adminapi.StaffIDFromContext(ctx)
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	if body.Name != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET name = $2, updated_at = now() WHERE id = $1`, id, *body.Name)
	}
	if body.SortOrder != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET sort_order = $2, updated_at = now() WHERE id = $1`, id, *body.SortOrder)
	}
	if body.Active != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET active = $2, updated_at = now() WHERE id = $1`, id, *body.Active)
	}
	if body.NGRRevshareBps != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET ngr_revshare_bps = $2, updated_at = now() WHERE id = $1`, id, *body.NGRRevshareBps)
	}
	if body.FirstDepositCPAMinor != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET first_deposit_cpa_minor = $2, updated_at = now() WHERE id = $1`, id, *body.FirstDepositCPAMinor)
	}
	if body.DepositRevshareBps != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET deposit_revshare_bps = $2, updated_at = now() WHERE id = $1`, id, *body.DepositRevshareBps)
	}
	if body.MinReferredSignups != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET min_referred_signups = $2, updated_at = now() WHERE id = $1`, id, *body.MinReferredSignups)
	}
	if body.MinReferredDepositors != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET min_referred_depositors = $2, updated_at = now() WHERE id = $1`, id, *body.MinReferredDepositors)
	}
	if body.MinReferredDepositVolumeMinor != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE referral_program_tiers SET min_referred_deposit_volume_minor = $2, updated_at = now() WHERE id = $1`, id, *body.MinReferredDepositVolumeMinor)
	}
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'referral_tier.patch', 'referral_program_tier', $2::text, '{}'::jsonb)
	`, staffID, sid)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// GET /v1/admin/referrals/players/{id}/summary
func (h *Handler) getPlayerReferralAdminSummary(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "missing user id")
		return
	}
	summary, err := affiliate.HubReferralSummary(r.Context(), h.Pool, userID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "server_error", "summary failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"summary": summary})
}
