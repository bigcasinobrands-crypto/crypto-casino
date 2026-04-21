package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/chat"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	Pool    *pgxpool.Pool
	BOG     *blueocean.Client
	Cfg     *config.Config
	Redis   *redis.Client
	Fystack *fystack.Client
	ChatHub *chat.Hub
}

func (h *Handler) Mount(r chi.Router) {
	r.Use(adminapi.RequireAnyRole("admin", "support", "superadmin"))
	r.Get("/users", h.ListUsers)
	r.Get("/users/{id}", h.GetUser)
	r.Get("/users/{id}/facts", h.GetUserFacts)
	r.Get("/users/{id}/vip", h.getUserVIP)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/users/{id}/vip", h.patchUserVIP)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/users/{id}/compliance", h.PatchUserCompliance)
	r.Get("/vip/tiers", h.listVIPTiers)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/vip/tiers", h.createVIPTier)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/vip/tiers/{id}", h.patchVIPTier)
	r.Get("/vip/tiers/{id}/benefits", h.listVIPTierBenefits)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/vip/tiers/{id}/benefits", h.createVIPTierBenefit)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/vip/tiers/{id}/benefits/{bid}", h.patchVIPTierBenefit)
	r.With(adminapi.RequireAnyRole("superadmin")).Delete("/vip/tiers/{id}/benefits/{bid}", h.deleteVIPTierBenefit)
	r.Get("/vip/delivery/summary", h.vipDeliverySummary)
	r.Get("/vip/players", h.listVIPPlayers)
	r.Get("/users/{id}/export", h.GDPRExportUser)
	r.Get("/users/{id}/compliance-export", h.ComplianceExportUser)
	r.Get("/users/{id}/bonus-risk", h.UserBonusRiskDecisions)
	r.Get("/ledger", h.ListLedger)
	r.Get("/events/blueocean", h.ListBlueOcean)
	r.Get("/integrations/fystack/payments", h.ListFystackPayments)
	r.Get("/integrations/fystack/withdrawals", h.ListFystackWithdrawals)
	r.Post("/integrations/blueocean/sync-catalog", h.SyncBlueOceanCatalog)
	r.Get("/integrations/blueocean/status", h.BlueOceanStatus)
	r.Get("/system/operational-flags", h.OperationalFlags)
	r.Get("/ops/summary", h.OpsSummary)
	r.Get("/ops/fystack-webhook-deliveries", h.ListFystackWebhookDeliveries)
	r.Get("/ops/payment-flags", h.GetPaymentFlags)
	r.Get("/ops/deposit-assets", h.GetDepositAssets)
	r.Post("/client-logs", h.IngestClientLog)
	r.Get("/client-logs", h.ListClientLogs)
	r.Get("/client-logs/count", h.CountClientLogsSince)
	r.Get("/games", h.ListGamesAdmin)
	r.Get("/game-providers", h.ListGameProviders)
	r.Get("/game-launches", h.ListGameLaunches)
	r.Get("/game-disputes", h.ListGameDisputes)
	r.Get("/dashboard/kpis", h.DashboardKPIs)
	r.Get("/dashboard/charts", h.DashboardCharts)
	r.Get("/dashboard/top-games", h.DashboardTopGames)
	r.Get("/dashboard/player-stats", h.DashboardPlayerStats)
	r.Get("/dashboard/system", h.DashboardSystem)
	r.Get("/games/{id}/rtp-stats", h.GameRTPStats)
	r.Get("/audit-log", h.AuditLog)
	r.Get("/search", h.SearchAdmin)
	r.Get("/staff-users", h.ListStaffUsers)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/staff-users", h.CreateStaffUser)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/staff-users/{id}", h.PatchStaffUser)
	r.Get("/withdrawals/pending-approval", h.ListPendingWithdrawals)
	r.Get("/settings", h.GetSettings)
	r.Get("/content", h.GetAllContent)
	r.Get("/content/{key}", h.GetContentByKey)
	r.Group(func(r chi.Router) {
		r.Use(adminapi.RequireAnyRole("superadmin"))
		r.Patch("/games/{id}/hidden", h.PatchGameHidden)
		r.Patch("/game-providers/lobby-hidden", h.PatchProviderLobbyHidden)
		r.Patch("/ops/payment-flags", h.PatchPaymentFlags)
		r.Post("/ops/reconcile-fystack", h.PostOpsReconcileFystack)
		r.Post("/ops/fystack-webhook-deliveries/{id}/reprocess", h.PostReprocessFystackWebhookDelivery)
		r.Post("/ops/provision-fystack-wallet", h.PostOpsProvisionFystackWallet)
		r.Post("/withdrawals/{id}/approve", h.ApproveWithdrawal)
		r.Post("/withdrawals/{id}/reject", h.RejectWithdrawal)
		r.Patch("/settings", h.PatchSettings)
		r.Put("/content/{key}", h.PutContent)
		r.Post("/content/upload", h.UploadContentImage)
	})
	if h.ChatHub != nil {
		r.Route("/chat", func(sr chi.Router) {
			chat.MountStaffRoutes(sr, h.ChatHub, h.Pool)
		})
	}
	h.mountBonusHub(r)
}

// MountPublicRoutes registers content/settings endpoints that do NOT require admin auth.
// Call this on the public (player-facing) router, outside the admin middleware group.
func (h *Handler) MountPublicRoutes(r chi.Router) {
	r.Get("/settings/public", h.GetSettingsPublic)
	r.Get("/content/bundle", h.ContentBundle)
	r.Get("/content/{key}", h.ContentByKeyPublic)
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 50)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, email, created_at, username, avatar_url FROM users ORDER BY created_at DESC LIMIT $1
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
		var uname, avatar *string
		if err := rows.Scan(&id, &email, &ct, &uname, &avatar); err != nil {
			continue
		}
		u := map[string]any{"id": id, "email": email, "created_at": ct.UTC().Format(time.RFC3339)}
		if uname != nil {
			u["username"] = *uname
		}
		if avatar != nil {
			u["avatar_url"] = *avatar
		}
		list = append(list, u)
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
			SELECT id, user_id::text, amount_minor, currency, entry_type, idempotency_key, pocket, created_at
			FROM ledger_entries WHERE user_id = $1::uuid ORDER BY id DESC LIMIT $2
		`, uid, limit)
	} else {
		rows, err = h.Pool.Query(r.Context(), `
			SELECT id, user_id::text, amount_minor, currency, entry_type, idempotency_key, pocket, created_at
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
		var uid, ccy, etype, idem, pocket string
		var amount int64
		var ct time.Time
		if err := rows.Scan(&id, &uid, &amount, &ccy, &etype, &idem, &pocket, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": strconv.FormatInt(id, 10), "user_id": uid, "amount_minor": amount, "currency": ccy,
			"entry_type": etype, "idempotency_key": idem, "pocket": pocket, "created_at": ct.UTC().Format(time.RFC3339),
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
