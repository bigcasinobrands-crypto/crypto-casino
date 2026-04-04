package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	Pool *pgxpool.Pool
	BOG  *blueocean.Client
	Cfg  *config.Config
}

func (h *Handler) Mount(r chi.Router) {
	r.Use(adminapi.RequireAnyRole("admin", "support"))
	r.Get("/users", h.ListUsers)
	r.Get("/users/{id}", h.GetUser)
	r.Get("/users/{id}/export", h.GDPRExportUser)
	r.Get("/ledger", h.ListLedger)
	r.Get("/events/blueocean", h.ListBlueOcean)
	r.Get("/integrations/fystack/payments", h.ListFystackPayments)
	r.Get("/integrations/fystack/withdrawals", h.ListFystackWithdrawals)
	r.Post("/integrations/blueocean/sync-catalog", h.SyncBlueOceanCatalog)
	r.Get("/integrations/blueocean/status", h.BlueOceanStatus)
	r.Get("/system/operational-flags", h.OperationalFlags)
	r.Get("/games", h.ListGamesAdmin)
	r.Get("/game-launches", h.ListGameLaunches)
	r.Get("/game-disputes", h.ListGameDisputes)
	r.Group(func(r chi.Router) {
		r.Use(adminapi.RequireAnyRole("admin"))
		r.Patch("/games/{id}/hidden", h.PatchGameHidden)
	})
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 50)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, email, created_at FROM users ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, email string
		var ct time.Time
		if err := rows.Scan(&id, &email, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{"id": id, "email": email, "created_at": ct.UTC().Format(time.RFC3339)})
	}
	writeJSON(w, map[string]any{"users": list})
}

func (h *Handler) ListLedger(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	uid := strings.TrimSpace(r.URL.Query().Get("user_id"))
	var rows pgx.Rows
	var err error
	if uid != "" {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT id, user_id::text, amount_minor, currency, entry_type, idempotency_key, created_at
			FROM ledger_entries WHERE user_id = $1::uuid ORDER BY id DESC LIMIT $2
		`, uid, limit)
	} else {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT id, user_id::text, amount_minor, currency, entry_type, idempotency_key, created_at
			FROM ledger_entries ORDER BY id DESC LIMIT $1
		`, limit)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var uid, ccy, etype, idem string
		var amount int64
		var ct time.Time
		if err := rows.Scan(&id, &uid, &amount, &ccy, &etype, &idem, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": strconv.FormatInt(id, 10), "user_id": uid, "amount_minor": amount, "currency": ccy,
			"entry_type": etype, "idempotency_key": idem, "created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"entries": list})
}

func (h *Handler) ListBlueOcean(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, provider_event_id, status, verified, created_at FROM blueocean_events ORDER BY id DESC LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var peid, status string
		var ver bool
		var ct time.Time
		if err := rows.Scan(&id, &peid, &status, &ver, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "provider_event_id": peid, "status": status, "verified": ver,
			"created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"events": list})
}

func (h *Handler) ListFystackPayments(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, user_id::text, status, created_at FROM fystack_payments ORDER BY created_at DESC NULLS LAST LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, status string
		var uid *string
		var ct time.Time
		if err := rows.Scan(&id, &uid, &status, &ct); err != nil {
			continue
		}
		m := map[string]any{"id": id, "status": status, "created_at": ct.UTC().Format(time.RFC3339)}
		if uid != nil {
			m["user_id"] = *uid
		}
		list = append(list, m)
	}
	writeJSON(w, map[string]any{"payments": list})
}

func (h *Handler) ListFystackWithdrawals(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, user_id::text, status, amount_minor, currency, created_at FROM fystack_withdrawals ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, uid, status, ccy string
		var amount int64
		var ct time.Time
		if err := rows.Scan(&id, &uid, &status, &amount, &ccy, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "user_id": uid, "status": status, "amount_minor": amount,
			"currency": ccy, "created_at": ct.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, map[string]any{"withdrawals": list})
}

func parseLimit(s string, def int) int {
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 || n > 500 {
		return def
	}
	return n
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
