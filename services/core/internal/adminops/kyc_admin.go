package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

// KYC review admin endpoints (E-4).
//
// Backed by the columns added in migration 00071:
//   users.kyc_status (none|pending|approved|rejected)
//   users.kyc_reviewed_at
//   users.kyc_reviewed_by_staff_user_id
//   users.kyc_reject_reason
//
// Players reach 'pending' by submitting documents through the player portal
// (uploads land in user_kyc_documents). Operators move them to approved or
// rejected here. Approval is what the withdraw KYC gate
// (compliance.CheckKYCForLargeWithdrawal) reads, so this endpoint is the
// only thing that lifts the large-withdrawal block.

type kycReviewItem struct {
	UserID        string  `json:"user_id"`
	Email         *string `json:"email,omitempty"`
	Status        string  `json:"status"`
	ReviewedAt    *string `json:"reviewed_at,omitempty"`
	ReviewedBy    *string `json:"reviewed_by,omitempty"`
	RejectReason  *string `json:"reject_reason,omitempty"`
}

// ListPendingKYC returns users currently in 'pending' KYC, oldest first so
// the operator queue is FIFO. The frontend uses this to populate the KYC
// review inbox.
func (h *Handler) ListPendingKYC(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, email, COALESCE(kyc_status,'none'),
		       to_char(kyc_reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       kyc_reviewed_by_staff_user_id::text,
		       kyc_reject_reason
		FROM users
		WHERE kyc_status = 'pending'
		ORDER BY created_at ASC
		LIMIT 500
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "kyc_list_failed", err.Error())
		return
	}
	defer rows.Close()
	out := []kycReviewItem{}
	for rows.Next() {
		var (
			it     kycReviewItem
			email  *string
			revAt  *string
			revBy  *string
			reason *string
		)
		if err := rows.Scan(&it.UserID, &email, &it.Status, &revAt, &revBy, &reason); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "kyc_list_scan", err.Error())
			return
		}
		it.Email, it.ReviewedAt, it.ReviewedBy, it.RejectReason = email, revAt, revBy, reason
		out = append(out, it)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out, "count": len(out)})
}

// GetUserKYC returns the KYC state for a single user (used by the player
// detail page in the admin console to show approval state).
func (h *Handler) GetUserKYC(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(chi.URLParam(r, "id"))
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_user", "user id required")
		return
	}
	var (
		it     kycReviewItem
		email  *string
		revAt  *string
		revBy  *string
		reason *string
	)
	err := h.Pool.QueryRow(r.Context(), `
		SELECT id::text, email, COALESCE(kyc_status,'none'),
		       to_char(kyc_reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       kyc_reviewed_by_staff_user_id::text,
		       kyc_reject_reason
		FROM users WHERE id = $1::uuid
	`, uid).Scan(&it.UserID, &email, &it.Status, &revAt, &revBy, &reason)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "user_not_found", err.Error())
		return
	}
	it.Email, it.ReviewedAt, it.ReviewedBy, it.RejectReason = email, revAt, revBy, reason
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(it)
}

type kycReviewReq struct {
	Reason string `json:"reason"`
}

// ApproveUserKYC marks a user kyc_status='approved'. Superadmin only (route
// is mounted under the superadmin group). Records an admin_audit_log entry
// so we have a paper trail of who approved which player; this is the same
// audit row the SAR/AML team reads when reconstructing fund movements.
func (h *Handler) ApproveUserKYC(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(chi.URLParam(r, "id"))
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_user", "user id required")
		return
	}
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	staff = strings.TrimSpace(staff)
	if staff == "" {
		adminapi.WriteError(w, http.StatusForbidden, "no_staff", "no staff identity on request")
		return
	}
	var req kycReviewReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	tag, err := h.Pool.Exec(r.Context(), `
		UPDATE users
		SET kyc_status = 'approved',
		    kyc_reviewed_at = now(),
		    kyc_reviewed_by_staff_user_id = NULLIF($1,'')::uuid,
		    kyc_reject_reason = NULL,
		    updated_at = now()
		WHERE id = $2::uuid
	`, staff, uid)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "kyc_approve_failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "user_not_found", "no user with that id")
		return
	}
	h.auditExec(r.Context(), "kyc.approve", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, payload)
		VALUES (NULLIF($1,'')::uuid, 'kyc.approve', 'user', $2, jsonb_build_object('note', $3::text))
	`, staff, uid, req.Reason)
	_ = adminapi.ConsumeStepUpForAction(r.Context(), h.Pool, "kyc.approve")
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true,"status":"approved"}`))
}

// RejectUserKYC marks a user kyc_status='rejected' with the operator's reason
// recorded both on the user row (so the player can see "your KYC was
// rejected because X" in the wallet UI) and in admin_audit_log (for
// regulators / SARs).
func (h *Handler) RejectUserKYC(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(chi.URLParam(r, "id"))
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_user", "user id required")
		return
	}
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	staff = strings.TrimSpace(staff)
	if staff == "" {
		adminapi.WriteError(w, http.StatusForbidden, "no_staff", "no staff identity on request")
		return
	}
	var req kycReviewReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.Reason) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "reason_required", "rejection reason is required")
		return
	}
	tag, err := h.Pool.Exec(r.Context(), `
		UPDATE users
		SET kyc_status = 'rejected',
		    kyc_reviewed_at = now(),
		    kyc_reviewed_by_staff_user_id = NULLIF($1,'')::uuid,
		    kyc_reject_reason = $3,
		    updated_at = now()
		WHERE id = $2::uuid
	`, staff, uid, strings.TrimSpace(req.Reason))
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "kyc_reject_failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "user_not_found", "no user with that id")
		return
	}
	h.auditExec(r.Context(), "kyc.reject", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, payload)
		VALUES (NULLIF($1,'')::uuid, 'kyc.reject', 'user', $2, jsonb_build_object('reason', $3::text))
	`, staff, uid, strings.TrimSpace(req.Reason))
	_ = adminapi.ConsumeStepUpForAction(r.Context(), h.Pool, "kyc.reject")
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true,"status":"rejected"}`))
}
