package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

// Financial DLQ admin endpoints (E-9).
//
// Lets the operator inbox surface jobs that the automated retry path could
// not resolve (status='failed' or stuck in 'in_progress'). The endpoints
// are read-only by default; an explicit POST /resolve marks a row as
// manually resolved (typically because the operator fixed the underlying
// state by hand and wants the queue to forget about it).
//
// Mounted under the support+admin scope so first-line ops can triage.
// Marking 'resolved' is reserved for superadmin to keep the audit trail
// tight on what is effectively an "unblock fix" override.

type finJobRow struct {
	ID            string         `json:"id"`
	JobType       string         `json:"job_type"`
	Payload       map[string]any `json:"payload,omitempty"`
	ErrorMessage  *string        `json:"error_message,omitempty"`
	AttemptCount  int            `json:"attempt_count"`
	NextRetryAt   *string        `json:"next_retry_at,omitempty"`
	Status        string         `json:"status"`
	ResolvedAt    *string        `json:"resolved_at,omitempty"`
	ResolvedBy    *string        `json:"resolved_by,omitempty"`
	RelatedID     *string        `json:"related_id,omitempty"`
	CreatedAt     string         `json:"created_at"`
	UpdatedAt     string         `json:"updated_at"`
}

// ListFinancialFailedJobs returns the most recent rows in financial_failed_jobs.
// Optional ?status=pending|in_progress|failed|resolved filters by state.
func (h *Handler) ListFinancialFailedJobs(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	allowedStatuses := map[string]bool{
		"":            true,
		"pending":     true,
		"in_progress": true,
		"failed":      true,
		"resolved":    true,
	}
	if !allowedStatuses[status] {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_status", "status must be one of pending|in_progress|failed|resolved")
		return
	}

	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, job_type, payload, error_message, attempt_count,
		       to_char(next_retry_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       status,
		       to_char(resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       resolved_by_staff_user_id::text,
		       related_id,
		       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM financial_failed_jobs
		WHERE ($1 = '' OR status = $1)
		ORDER BY created_at DESC
		LIMIT 200
	`, status)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	defer rows.Close()

	out := []finJobRow{}
	for rows.Next() {
		var (
			row        finJobRow
			payloadRaw []byte
			errMsg     *string
			nextAt     *string
			resAt      *string
			resBy      *string
			relID      *string
		)
		if err := rows.Scan(&row.ID, &row.JobType, &payloadRaw, &errMsg, &row.AttemptCount,
			&nextAt, &row.Status, &resAt, &resBy, &relID, &row.CreatedAt, &row.UpdatedAt); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "scan_failed", err.Error())
			return
		}
		if len(payloadRaw) > 0 {
			_ = json.Unmarshal(payloadRaw, &row.Payload)
		}
		row.ErrorMessage, row.NextRetryAt, row.ResolvedAt, row.ResolvedBy, row.RelatedID = errMsg, nextAt, resAt, resBy, relID
		out = append(out, row)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out, "count": len(out)})
}

// ResolveFinancialFailedJob lets a superadmin mark a row resolved manually.
// Intended for cases where the operator has manually fixed the underlying
// state and just wants the queue to drop the row. Records the resolving
// staff id and an audit log entry.
func (h *Handler) ResolveFinancialFailedJob(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_id", "job id required")
		return
	}
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	staff = strings.TrimSpace(staff)
	if staff == "" {
		adminapi.WriteError(w, http.StatusForbidden, "no_staff", "no staff identity on request")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if strings.TrimSpace(body.Reason) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "reason_required", "manual resolution must include a reason")
		return
	}

	tag, err := h.Pool.Exec(r.Context(), `
		UPDATE financial_failed_jobs
		SET status = 'resolved',
		    resolved_at = now(),
		    resolved_by_staff_user_id = NULLIF($2,'')::uuid,
		    error_message = COALESCE(error_message,'') || ' | manual: ' || $3,
		    updated_at = now()
		WHERE id = $1::uuid AND status <> 'resolved'
	`, id, staff, strings.TrimSpace(body.Reason))
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "resolve_failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found_or_resolved", "no row found or already resolved")
		return
	}

	h.auditExec(r.Context(), "finjobs.resolve", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, payload)
		VALUES (NULLIF($1,'')::uuid, 'finjobs.resolve', 'financial_failed_jobs', $2, jsonb_build_object('reason', $3::text))
	`, staff, id, strings.TrimSpace(body.Reason))
	_ = adminapi.ConsumeStepUpForAction(r.Context(), h.Pool, "finjobs.resolve")

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}
