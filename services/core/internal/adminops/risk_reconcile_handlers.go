package adminops

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
)

// ListRiskAssessments returns recent Fingerprint-linked risk assessment rows (staff audit).
func (h *Handler) ListRiskAssessments(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	limit := 50
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, user_id::text, source, fingerprint_request_id, fingerprint_visitor_id,
			ledger_snapshot, raw_event, created_at
		FROM risk_assessments
		ORDER BY id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var uid, src, fpr, fvis string
		var snap, raw []byte
		var ct time.Time
		if err := rows.Scan(&id, &uid, &src, &fpr, &fvis, &snap, &raw, &ct); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "scan failed")
			return
		}
		var snapJ, rawJ any
		_ = json.Unmarshal(snap, &snapJ)
		_ = json.Unmarshal(raw, &rawJ)
		out = append(out, map[string]any{
			"id":                     id,
			"user_id":                uid,
			"source":                 src,
			"fingerprint_request_id": fpr,
			"fingerprint_visitor_id": fvis,
			"ledger_snapshot":        snapJ,
			"raw_event":              rawJ,
			"created_at":             ct.UTC().Format(time.RFC3339),
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

// ListReconciliationAlerts returns ledger reconciliation flags (e.g. geo mismatch).
func (h *Handler) ListReconciliationAlerts(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	limit := 50
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, kind, user_id::text, reference_type, reference_id, details,
			created_at, acknowledged_at, acknowledged_by_staff::text
		FROM reconciliation_alerts
		ORDER BY id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var kind, refType, refID string
		var uid sql.NullString
		var details []byte
		var ct time.Time
		var ackAt sql.NullTime
		var ackStaff sql.NullString
		if err := rows.Scan(&id, &kind, &uid, &refType, &refID, &details, &ct, &ackAt, &ackStaff); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "scan failed")
			return
		}
		var detJ any
		_ = json.Unmarshal(details, &detJ)
		m := map[string]any{
			"id":             id,
			"kind":           kind,
			"reference_type": refType,
			"reference_id":   refID,
			"details":        detJ,
			"created_at":     ct.UTC().Format(time.RFC3339),
		}
		if uid.Valid {
			m["user_id"] = uid.String
		}
		if ackAt.Valid {
			m["acknowledged_at"] = ackAt.Time.UTC().Format(time.RFC3339)
		}
		if ackStaff.Valid {
			m["acknowledged_by_staff"] = ackStaff.String
		}
		out = append(out, m)
	}
	if out == nil {
		out = []map[string]any{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}
