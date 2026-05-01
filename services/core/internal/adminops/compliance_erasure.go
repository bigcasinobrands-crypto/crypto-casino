package adminops

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/compliance"
	"github.com/crypto-casino/core/internal/jobs"
)

type erasureEnqueueBody struct {
	UserID string `json:"user_id"`
}

// EnqueuePlayerErasure queues a compliance tombstone for a player (superadmin).
func (h *Handler) EnqueuePlayerErasure(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "")
		return
	}
	var body erasureEnqueueBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "")
		return
	}
	uid := strings.TrimSpace(body.UserID)
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_user", "user_id required")
		return
	}
	var jobID int64
	err := h.Pool.QueryRow(r.Context(), `
		INSERT INTO compliance_erasure_jobs (user_id, requested_by_staff_id, status)
		VALUES ($1::uuid, $2::uuid, 'pending') RETURNING id
	`, uid, staffID).Scan(&jobID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "could not queue job")
		return
	}
	meta, _ := json.Marshal(map[string]any{"user_id": uid, "job_id": jobID})
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, meta)
		VALUES ($1::uuid, 'compliance.erasure_enqueue', 'users', $2, $3)
	`, staffID, uid, meta)

	if h.Redis != nil {
		raw, _ := json.Marshal(map[string]int64{"job_id": jobID})
		if err := jobs.Enqueue(r.Context(), h.Redis, jobs.Job{Type: "compliance_erasure", Data: raw}); err != nil {
			adminapi.WriteError(w, http.StatusServiceUnavailable, "queue_error", "redis enqueue failed")
			return
		}
	} else {
		go func(id int64) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			_ = compliance.ProcessErasureJob(ctx, h.Pool, id)
		}(jobID)
	}
	writeJSON(w, map[string]any{"ok": true, "job_id": jobID})
}

// ListComplianceErasureJobs returns recent erasure jobs.
func (h *Handler) ListComplianceErasureJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, user_id::text, status, requested_by_staff_id::text, error_text,
			created_at, started_at, completed_at
		FROM compliance_erasure_jobs ORDER BY id DESC LIMIT 100
	`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var uid, st string
		var reqStaff *string
		var errText *string
		var ca, sa, co interface{}
		if err := rows.Scan(&id, &uid, &st, &reqStaff, &errText, &ca, &sa, &co); err != nil {
			continue
		}
		row := map[string]any{"id": id, "user_id": uid, "status": st, "created_at": ca, "started_at": sa, "completed_at": co}
		if reqStaff != nil {
			row["requested_by_staff_id"] = *reqStaff
		}
		if errText != nil {
			row["error_text"] = *errText
		}
		list = append(list, row)
	}
	writeJSON(w, map[string]any{"jobs": list})
}
