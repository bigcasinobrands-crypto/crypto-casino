package adminops

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxClientLogCodeLen = 128
	maxClientLogMessageLen  = 2000
	maxClientLogSourceLen   = 512
	maxClientLogDetailLen   = 4000
	maxClientLogRequestID   = 128
	maxClientLogUserAgent   = 512
	maxClientLogClientBuild = 128
)

// PurgeAdminClientLogs deletes rows older than 90 days (rolling window).
func PurgeAdminClientLogs(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `
		DELETE FROM admin_client_logs
		WHERE created_at < now() - interval '90 days'
	`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

type clientLogIngestReq struct {
	Severity   string `json:"severity"`
	Code       string `json:"code"`
	HTTPStatus int    `json:"http_status"`
	Message    string `json:"message"`
	Source     string `json:"source"`
	RequestID  string `json:"request_id"`
	Detail     string `json:"detail"`
	ClientBuild string `json:"client_build"`
}

func clampStr(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 {
		return ""
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	if len(runes) > max {
		return string(runes[:max])
	}
	return s
}

func normalizeSeverity(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "warning", "warn":
		return "warning"
	case "info":
		return "info"
	default:
		return "error"
	}
}

func (h *Handler) IngestClientLog(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff context")
		return
	}
	var body clientLogIngestReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	sev := normalizeSeverity(body.Severity)
	msg := clampStr(body.Message, maxClientLogMessageLen)
	if msg == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_body", "message is required")
		return
	}
	code := clampStr(body.Code, maxClientLogCodeLen)
	src := clampStr(body.Source, maxClientLogSourceLen)
	detail := clampStr(body.Detail, maxClientLogDetailLen)
	rid := clampStr(body.RequestID, maxClientLogRequestID)
	build := clampStr(body.ClientBuild, maxClientLogClientBuild)
	ua := clampStr(r.UserAgent(), maxClientLogUserAgent)

	suid, err := uuid.Parse(staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_staff", "invalid staff id")
		return
	}

	ctx := r.Context()
	var id uuid.UUID
	err = h.Pool.QueryRow(ctx, `
		INSERT INTO admin_client_logs (
			staff_user_id, severity, code, http_status, message, source, request_id, detail, user_agent, client_build
		) VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''))
		RETURNING id
	`, suid, sev, code, body.HTTPStatus, msg, src, rid, detail, ua, build).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "failed to save log")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id.String()})
}

func (h *Handler) CountClientLogsSince(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff context")
		return
	}
	suid, err := uuid.Parse(staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_staff", "invalid staff id")
		return
	}
	after := strings.TrimSpace(r.URL.Query().Get("after"))
	var n int64
	if after == "" {
		err = h.Pool.QueryRow(r.Context(), `
			SELECT COUNT(*)::bigint FROM admin_client_logs
			WHERE staff_user_id = $1
			  AND created_at >= now() - interval '90 days'
		`, suid).Scan(&n)
	} else {
		t, errParse := time.Parse(time.RFC3339, after)
		if errParse != nil {
			adminapi.WriteError(w, http.StatusBadRequest, "invalid_after", "after must be RFC3339")
			return
		}
		err = h.Pool.QueryRow(r.Context(), `
			SELECT COUNT(*)::bigint FROM admin_client_logs
			WHERE staff_user_id = $1
			  AND created_at >= now() - interval '90 days'
			  AND created_at > $2::timestamptz
		`, suid, t).Scan(&n)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "count failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]int64{"count": n})
}

func (h *Handler) ListClientLogs(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff context")
		return
	}
	suid, err := uuid.Parse(staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_staff", "invalid staff id")
		return
	}
	limit := parseLimit(r.URL.Query().Get("limit"), 50)
	if limit > 200 {
		limit = 200
	}
	offset := 0
	if o := strings.TrimSpace(r.URL.Query().Get("offset")); o != "" {
		if v, errConv := strconv.Atoi(o); errConv == nil && v >= 0 && v <= 100_000 {
			offset = v
		}
	}

	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, created_at, severity, code, http_status, message, source,
		       COALESCE(request_id, ''), COALESCE(detail, ''), COALESCE(user_agent, ''), COALESCE(client_build, '')
		FROM admin_client_logs
		WHERE staff_user_id = $1
		  AND created_at >= now() - interval '90 days'
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, suid, limit, offset)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, sev, code, msg, src, rid, det, uas, build string
		var httpSt int
		var ct time.Time
		if err := rows.Scan(&id, &ct, &sev, &code, &httpSt, &msg, &src, &rid, &det, &uas, &build); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id":           id,
			"created_at":   ct.UTC().Format(time.RFC3339),
			"severity":     sev,
			"code":         code,
			"http_status":  httpSt,
			"message":      msg,
			"source":       src,
			"request_id":   rid,
			"detail":       det,
			"user_agent":   uas,
			"client_build": build,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"entries": list})
}
