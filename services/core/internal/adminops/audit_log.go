package adminops

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
)

func (h *Handler) AuditLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit := parseLimit(q.Get("limit"), 50)
	if limit > 200 {
		limit = 200
	}
	offset, _ := strconv.Atoi(q.Get("offset"))
	if offset < 0 {
		offset = 0
	}

	var clauses []string
	var args []any
	argIdx := 1

	if v := strings.TrimSpace(q.Get("staff_id")); v != "" {
		clauses = append(clauses, fmt.Sprintf("a.staff_user_id = $%d::uuid", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("action")); v != "" {
		clauses = append(clauses, fmt.Sprintf("a.action = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("target_type")); v != "" {
		clauses = append(clauses, fmt.Sprintf("a.target_type = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("after")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "after must be RFC3339")
			return
		}
		clauses = append(clauses, fmt.Sprintf("a.created_at >= $%d", argIdx))
		args = append(args, t)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("before")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "before must be RFC3339")
			return
		}
		clauses = append(clauses, fmt.Sprintf("a.created_at <= $%d", argIdx))
		args = append(args, t)
		argIdx++
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	ctx := r.Context()

	var totalCount int64
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM admin_audit_log a %s`, where)
	if err := h.Pool.QueryRow(ctx, countQ, args...).Scan(&totalCount); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "count query failed")
		return
	}

	dataQ := fmt.Sprintf(`
		SELECT a.id, a.staff_user_id::text, COALESCE(s.email,''), a.action,
		       a.target_type, COALESCE(a.target_id,''), COALESCE(a.meta::text,'{}'), a.created_at
		FROM admin_audit_log a
		LEFT JOIN staff_users s ON s.id = a.staff_user_id
		%s
		ORDER BY a.created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)
	dataArgs := append(args, limit, offset)

	rows, err := h.Pool.Query(ctx, dataQ, dataArgs...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	type entry struct {
		ID          int64
		StaffUserID string
		StaffEmail  string
		Action      string
		TargetType  string
		TargetID    string
		Meta        string
		CreatedAt   time.Time
	}
	var entries []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.ID, &e.StaffUserID, &e.StaffEmail, &e.Action,
			&e.TargetType, &e.TargetID, &e.Meta, &e.CreatedAt); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	if r.Header.Get("Accept") == "text/csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", `attachment; filename="audit-log.csv"`)
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"id", "staff_email", "action", "target_type", "target_id", "created_at"})
		for _, e := range entries {
			_ = cw.Write([]string{
				strconv.FormatInt(e.ID, 10),
				e.StaffEmail,
				e.Action,
				e.TargetType,
				e.TargetID,
				e.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
		cw.Flush()
		return
	}

	list := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		var meta any
		if err := json.Unmarshal([]byte(e.Meta), &meta); err != nil {
			meta = map[string]any{}
		}
		list = append(list, map[string]any{
			"id":            e.ID,
			"staff_user_id": e.StaffUserID,
			"staff_email":   e.StaffEmail,
			"action":        e.Action,
			"target_type":   e.TargetType,
			"target_id":     e.TargetID,
			"meta":          meta,
			"created_at":    e.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"entries": list, "total_count": totalCount})
}

func (h *Handler) SearchAdmin(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "q is required")
		return
	}
	ctx := r.Context()

	players := make([]map[string]any, 0)
	pRows, err := h.Pool.Query(ctx, `
		SELECT u.id::text, COALESCE(u.email,''), COALESCE(u.username,''),
			vt.name, pvs.tier_id
		FROM users u
		LEFT JOIN player_vip_state pvs ON pvs.user_id = u.id
		LEFT JOIN vip_tiers vt ON vt.id = pvs.tier_id
		WHERE u.email ILIKE '%' || $1 || '%'
		   OR u.username ILIKE '%' || $1 || '%'
		   OR u.id::text = $1
		LIMIT 10
	`, q)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "user search failed")
		return
	}
	defer pRows.Close()
	for pRows.Next() {
		var id, email, uname string
		var vipName *string
		var vipTid *int
		if err := pRows.Scan(&id, &email, &uname, &vipName, &vipTid); err != nil {
			continue
		}
		m := map[string]any{"id": id, "email": email, "username": uname}
		if vipName != nil && *vipName != "" {
			m["vip_tier"] = *vipName
		}
		if vipTid != nil {
			m["vip_tier_id"] = *vipTid
		}
		players = append(players, m)
	}

	transactions := make([]map[string]any, 0)
	tRows, err := h.Pool.Query(ctx, `
		SELECT id, entry_type, amount_minor, created_at
		FROM ledger_entries
		WHERE idempotency_key ILIKE '%' || $1 || '%'
		LIMIT 10
	`, q)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "ledger search failed")
		return
	}
	defer tRows.Close()
	for tRows.Next() {
		var id int64
		var etype string
		var amount int64
		var ct time.Time
		if err := tRows.Scan(&id, &etype, &amount, &ct); err != nil {
			continue
		}
		transactions = append(transactions, map[string]any{
			"id": strconv.FormatInt(id, 10), "entry_type": etype,
			"amount_minor": amount, "created_at": ct.UTC().Format(time.RFC3339),
		})
	}

	writeJSON(w, map[string]any{"players": players, "transactions": transactions})
}
