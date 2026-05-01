package adminops

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/go-chi/chi/v5"
)

// bonusHubBonusAuditLog lists append-only bonus_audit_log rows (compliance).
func (h *Handler) bonusHubBonusAuditLog(w http.ResponseWriter, r *http.Request) {
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

	if v := strings.TrimSpace(q.Get("user_id")); v != "" {
		clauses = append(clauses, fmt.Sprintf("b.user_id = $%d::uuid", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("event_type")); v != "" {
		clauses = append(clauses, fmt.Sprintf("b.event_type = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("bonus_instance_id")); v != "" {
		clauses = append(clauses, fmt.Sprintf("b.bonus_instance_id = $%d::uuid", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("after")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "after must be RFC3339")
			return
		}
		clauses = append(clauses, fmt.Sprintf("b.created_at >= $%d", argIdx))
		args = append(args, t)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("before")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "before must be RFC3339")
			return
		}
		clauses = append(clauses, fmt.Sprintf("b.created_at <= $%d", argIdx))
		args = append(args, t)
		argIdx++
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	ctx := r.Context()

	var total int64
	countQ := fmt.Sprintf(`SELECT COUNT(*)::bigint FROM bonus_audit_log b %s`, where)
	if err := h.Pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "count failed")
		return
	}

	dataQ := fmt.Sprintf(`
		SELECT b.id, b.event_type, b.actor_type, COALESCE(b.actor_id,''), b.user_id::text,
		       COALESCE(b.bonus_instance_id::text,''), COALESCE(b.promotion_version_id,0),
		       b.amount_delta_minor, b.currency, COALESCE(b.metadata::text,'{}'), b.created_at
		FROM bonus_audit_log b
		%s
		ORDER BY b.id DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)
	dataArgs := append(args, limit, offset)

	rows, err := h.Pool.Query(ctx, dataQ, dataArgs...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	var entries []map[string]any
	for rows.Next() {
		var id int64
		var eventType, actorType, actorID, userID, instID, ccy, metaJSON string
		var pvid, amt int64
		var ct time.Time
		if err := rows.Scan(&id, &eventType, &actorType, &actorID, &userID, &instID, &pvid, &amt, &ccy, &metaJSON, &ct); err != nil {
			continue
		}
		var meta map[string]any
		_ = json.Unmarshal([]byte(metaJSON), &meta)
		entries = append(entries, map[string]any{
			"id": id, "event_type": eventType, "actor_type": actorType, "actor_id": actorID,
			"user_id": userID, "bonus_instance_id": instID, "promotion_version_id": pvid,
			"amount_delta_minor": amt, "currency": ccy, "metadata": meta,
			"created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"entries": entries, "total_count": total})
}

// bonusHubBonusOutbox lists bonus_outbox rows (pending, delivered, or DLQ).
func (h *Handler) bonusHubBonusOutbox(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := parseLimit(q.Get("limit"), 50)
	if limit > 200 {
		limit = 200
	}
	offset, _ := strconv.Atoi(q.Get("offset"))
	if offset < 0 {
		offset = 0
	}
	state := strings.TrimSpace(strings.ToLower(q.Get("state")))
	var clauses []string
	var args []any
	argIdx := 1
	switch state {
	case "pending":
		clauses = append(clauses, "o.processed_at IS NULL AND o.dlq_at IS NULL")
	case "dlq":
		clauses = append(clauses, "o.dlq_at IS NOT NULL")
	case "done", "delivered":
		clauses = append(clauses, "o.processed_at IS NOT NULL")
	case "all", "":
		// no filter
	default:
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "state must be pending|dlq|done|all")
		return
	}
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	ctx := r.Context()
	var total int64
	countQ := fmt.Sprintf(`SELECT COUNT(*)::bigint FROM bonus_outbox o %s`, where)
	if err := h.Pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "count failed")
		return
	}
	dataQ := fmt.Sprintf(`
		SELECT o.id, o.event_type, COALESCE(o.payload::text,'{}'), o.created_at, o.processed_at, o.attempts, COALESCE(o.last_error,''), o.dlq_at
		FROM bonus_outbox o
		%s
		ORDER BY o.id DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)
	dataArgs := append(args, limit, offset)
	rows, err := h.Pool.Query(ctx, dataQ, dataArgs...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var entries []map[string]any
	for rows.Next() {
		var id int64
		var eventType, payload, lastErr string
		var attempts int
		var createdAt time.Time
		var processedAt, dlqAt *time.Time
		if err := rows.Scan(&id, &eventType, &payload, &createdAt, &processedAt, &attempts, &lastErr, &dlqAt); err != nil {
			continue
		}
		m := map[string]any{
			"id": id, "event_type": eventType, "attempts": attempts, "last_error": lastErr,
			"created_at": createdAt.UTC().Format(time.RFC3339),
		}
		if processedAt != nil {
			m["processed_at"] = processedAt.UTC().Format(time.RFC3339)
		} else {
			m["processed_at"] = nil
		}
		if dlqAt != nil {
			m["dlq_at"] = dlqAt.UTC().Format(time.RFC3339)
		} else {
			m["dlq_at"] = nil
		}
		var payloadObj map[string]any
		if json.Unmarshal([]byte(payload), &payloadObj) == nil {
			m["payload"] = payloadObj
		} else {
			m["payload"] = payload
		}
		entries = append(entries, m)
	}
	writeJSON(w, map[string]any{"entries": entries, "total_count": total})
}

// bonusHubRedriveBonusOutbox clears DLQ on a stuck row so the worker will pick it up again (attempts reset).
func (h *Handler) bonusHubRedriveBonusOutbox(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	idStr := strings.TrimSpace(chi.URLParam(r, "id"))
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_id", "bad id")
		return
	}
	ctx := r.Context()
	ct, err := h.Pool.Exec(ctx, `
		UPDATE bonus_outbox
		SET dlq_at = NULL, attempts = 0, last_error = NULL
		WHERE id = $1 AND processed_at IS NULL AND dlq_at IS NOT NULL
	`, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	if ct.RowsAffected() == 0 {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "row is not in DLQ or already processed")
		return
	}
	meta, _ := json.Marshal(map[string]any{"bonus_outbox_id": id})
	_, _ = h.Pool.Exec(ctx, `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'bonushub.bonus_outbox_redrive', 'bonus_outbox', $2::jsonb)
	`, staffID, meta)
	obs.IncBonusOutboxRedriven()
	writeJSON(w, map[string]any{"ok": true, "id": id})
}

// bonusHubWagerViolations lists max-bet / excluded-game reject rows (R1 visibility).
func (h *Handler) bonusHubWagerViolations(w http.ResponseWriter, r *http.Request) {
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
	if v := strings.TrimSpace(q.Get("user_id")); v != "" {
		clauses = append(clauses, fmt.Sprintf("v.user_id = $%d::uuid", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("bonus_instance_id")); v != "" {
		clauses = append(clauses, fmt.Sprintf("v.bonus_instance_id = $%d::uuid", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := strings.TrimSpace(q.Get("violation_type")); v != "" {
		clauses = append(clauses, fmt.Sprintf("v.violation_type = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	ctx := r.Context()
	var total int64
	countQ := fmt.Sprintf(`SELECT COUNT(*)::bigint FROM bonus_wager_violations v %s`, where)
	if err := h.Pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "count failed")
		return
	}
	dataQ := fmt.Sprintf(`
		SELECT v.id, v.user_id::text, COALESCE(u.email,''), v.bonus_instance_id::text, v.game_id,
		       v.stake_minor, v.max_bet_minor, v.violation_type, COALESCE(v.source_ref,''), v.created_at
		FROM bonus_wager_violations v
		LEFT JOIN users u ON u.id = v.user_id
		%s
		ORDER BY v.id DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)
	dataArgs := append(args, limit, offset)
	rows, err := h.Pool.Query(ctx, dataQ, dataArgs...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var entries []map[string]any
	for rows.Next() {
		var id int64
		var uid, email, instID, gid, vtype, src string
		var stake, maxBet int64
		var ct time.Time
		if err := rows.Scan(&id, &uid, &email, &instID, &gid, &stake, &maxBet, &vtype, &src, &ct); err != nil {
			continue
		}
		entries = append(entries, map[string]any{
			"id": id, "user_id": uid, "user_email": email, "bonus_instance_id": instID,
			"game_id": gid, "stake_minor": stake, "max_bet_minor": maxBet,
			"violation_type": vtype, "source_ref": src, "created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"entries": entries, "total_count": total})
}
