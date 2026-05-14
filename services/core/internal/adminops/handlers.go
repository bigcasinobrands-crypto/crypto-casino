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
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	Pool        *pgxpool.Pool
	BOG         *blueocean.Client
	Cfg         *config.Config
	Mail        mail.Sender
	Redis       *redis.Client
	Fingerprint *fingerprint.Client
	ChatHub     *chat.Hub
}

func (h *Handler) Mount(r chi.Router) {
	r.Use(adminapi.RequireAnyRole("admin", "support", "superadmin"))
	r.Get("/users", h.ListUsers)
	r.Get("/users/{id}", h.GetUser)
	r.Get("/users/{id}/facts", h.GetUserFacts)
	r.Post("/users/{id}/integrations/blueocean/sync-test", h.SyncBlueOceanPlayer)
	r.Get("/users/{id}/vip", h.getUserVIP)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/users/{id}/vip", h.patchUserVIP)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/users/{id}/compliance", h.PatchUserCompliance)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/users/{id}/email-2fa", h.PatchPlayerEmail2FA)
	r.With(adminapi.RequireAnyRole("superadmin")).Delete("/users/{id}", h.HardDeletePlayer)
	r.Get("/vip/tiers", h.listVIPTiers)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/vip/tiers", h.createVIPTier)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/vip/tiers/{id}", h.patchVIPTier)
	r.Get("/vip/tiers/{id}/benefits", h.listVIPTierBenefits)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/vip/tiers/{id}/benefits", h.createVIPTierBenefit)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/vip/tiers/{id}/benefits/{bid}", h.patchVIPTierBenefit)
	r.With(adminapi.RequireAnyRole("superadmin")).Delete("/vip/tiers/{id}/benefits/{bid}", h.deleteVIPTierBenefit)
	r.Get("/vip/delivery/summary", h.vipDeliverySummary)
	r.Get("/vip/delivery/runs", h.listVIPDeliveryRuns)
	r.Get("/vip/delivery/schedules", h.listVIPDeliverySchedules)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/vip/delivery/schedules/{pipeline}", h.patchVIPDeliverySchedule)
	r.Get("/vip/rewards/payout-log", h.listVIPRewardPayoutLog)
	r.Get("/vip/support/trace", h.adminVIPIdempotencyTrace)
	r.Get("/vip/support/players/{id}/snapshot", h.getVIPPlayerSupportSnapshot)
	r.Get("/vip/hunt/config", h.getHuntConfigAdmin)
	r.With(adminapi.RequireAnyRole("superadmin")).Put("/vip/hunt/config", h.putHuntConfigAdmin)
	r.Get("/vip/messages/preview", h.vipBroadcastPreview)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/vip/messages/broadcast", h.vipBroadcastMessage)
	r.Get("/vip/players", h.listVIPPlayers)
	r.Get("/compliance/player-erasure-jobs", h.ListComplianceErasureJobs)
	r.Get("/users/{id}/compliance-export", h.ComplianceExportUser)
	r.Get("/users/{id}/bonus-risk", h.UserBonusRiskDecisions)
	r.Get("/ledger", h.ListLedger)
	r.Get("/events/blueocean", h.ListBlueOcean)
	r.Get("/integrations/payments/deposit-intents", h.ListPaymentDepositIntents)
	r.Get("/integrations/payments/withdrawals", h.ListPaymentWithdrawals)
	r.Post("/integrations/blueocean/sync-catalog", h.SyncBlueOceanCatalog)
	r.Post("/integrations/blueocean/xapi", h.BlueOceanXAPI)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/integrations/blueocean/backfill-player-links", h.BackfillBlueOceanPlayerLinks)
	r.Get("/integrations/blueocean/status", h.BlueOceanStatus)
	r.Get("/system/operational-flags", h.OperationalFlags)
	r.Get("/ops/risk-assessments", h.ListRiskAssessments)
	r.Get("/ops/reconciliation-alerts", h.ListReconciliationAlerts)
	r.Get("/ops/summary", h.OpsSummary)
	r.Get("/ops/content-health", h.ContentHealth)
	r.Get("/ops/payment-flags", h.GetPaymentFlags)
	r.Get("/ops/deposit-assets", h.GetDepositAssets)
	r.Post("/client-logs", h.IngestClientLog)
	r.Get("/client-logs", h.ListClientLogs)
	r.Get("/client-logs/count", h.CountClientLogsSince)
	r.Get("/games", h.ListGamesAdmin)
	r.Get("/payments/deposit-assets", h.ListDepositAssets)
	// Same payload as deposit-assets: PassimPay currency keys / chains for prizes (not only deposits).
	r.Get("/payments/payout-options", h.ListDepositAssets)
	r.Get("/game-providers", h.ListGameProviders)
	r.Get("/game-launches", h.ListGameLaunches)
	r.Get("/game-disputes", h.ListGameDisputes)
	r.Get("/dashboard/kpis", h.DashboardKPIs)
	r.Get("/dashboard/charts", h.DashboardCharts)
	r.Get("/dashboard/top-games", h.DashboardTopGames)
	r.Get("/dashboard/player-stats", h.DashboardPlayerStats)
	r.Get("/dashboard/system", h.DashboardSystem)
	r.Get("/dashboard/casino-analytics", h.DashboardCasinoAnalytics)
	r.Get("/dashboard/ngr-breakdown", h.DashboardNGRBreakdown)
	r.With(adminapi.RequireAnyRole("superadmin")).Get("/debug/finance-ggr", h.DebugFinanceGGR)
	r.With(adminapi.RequireAnyRole("superadmin")).Get("/debug/finance-ngr", h.DebugFinanceNGR)
	r.With(adminapi.RequireAnyRole("superadmin")).Get("/debug/finance-ledger-reconciliation", h.DebugFinanceLedgerReconciliation)
	r.Get("/dashboard/crypto-chain-summary", h.DashboardCryptoChainSummary)
	r.Get("/analytics/traffic", h.TrafficAnalytics)
	r.Get("/analytics/finance-geo", h.FinanceGeoAnalytics)
	r.Get("/finance/fund-segregation", h.FundSegregationHandler())
	r.Get("/finance/failed-jobs", h.ListFinancialFailedJobs)
	r.Get("/finance/treasury-status", h.TreasuryStatus)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/ops/zero-playable-balances", h.ZeroPlayableBalances)
	r.Post("/auth/step-up", h.PostStepUpAssertion)
	r.Get("/compliance/kyc/pending", h.ListPendingKYC)
	r.Get("/compliance/kyc/{id}", h.GetUserKYC)
	r.Get("/integrations/oddin", h.OddinIntegrationStatus)
	r.Get("/games/{id}/rtp-stats", h.GameRTPStats)
	r.Get("/audit-log", h.AuditLog)
	r.Get("/search", h.SearchAdmin)
	r.Get("/referrals/tiers", h.listReferralProgramTiers)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/referrals/tiers/{id}", h.patchReferralProgramTier)
	r.Get("/referrals/players/{id}/summary", h.getPlayerReferralAdminSummary)
	r.Get("/staff-users", h.ListStaffUsers)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/staff-users", h.CreateStaffUser)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/staff-users/{id}", h.PatchStaffUser)
	r.Get("/withdrawals/pending-approval", h.ListPendingWithdrawals)
	r.Get("/settings", h.GetSettings)
	r.Get("/email/status", h.GetEmailStatus)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/email/transactional", h.PatchEmailTransactional)
	r.With(adminapi.RequireAnyRole("superadmin")).Post("/email/test-send", h.PostEmailTestSend)
	r.Get("/integrations/kycaid/status", h.GetKYCAIDIntegrationStatus)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/integrations/kycaid/settings", h.PatchKYCAIDSiteSettings)
	r.With(adminapi.RequireAnyRole("superadmin")).Patch("/compliance/withdraw-kyc-policy", h.PatchWithdrawKYCRiskPolicy)
	r.Get("/content", h.GetAllContent)
	r.Get("/content/{key}", h.GetContentByKey)
	r.Route("/security/approvals", func(ar chi.Router) {
		ar.Get("/", h.ListApprovalRequests)
		ar.Get("/{id}", h.GetApprovalRequest)
		ar.Post("/", h.CreateApprovalRequest)
		ar.Group(func(sr chi.Router) {
			sr.Use(adminapi.RequireAnyRole("superadmin"))
			sr.Post("/{id}/approve", h.ApproveApprovalRequest)
			sr.Post("/{id}/reject", h.RejectApprovalRequest)
		})
	})
	r.Group(func(r chi.Router) {
		r.Use(adminapi.RequireAnyRole("superadmin"))
		r.Patch("/games/{id}/hidden", h.PatchGameHidden)
		r.Patch("/games/{id}/thumbnail-override", h.PatchGameThumbnailOverride)
		r.Patch("/game-providers/lobby-hidden", h.PatchProviderLobbyHidden)
		r.Patch("/ops/payment-flags", h.PatchPaymentFlags)
		// SEC-6: high-value financial actions require a fresh step-up MFA
		// assertion (POST /auth/step-up) within the last 5 minutes. The
		// middleware reads from staff_step_up_assertions; route handlers
		// then call adminapi.ConsumeStepUpForAction to mark the assertion
		// used so a single step-up cannot drive multiple privileged writes.
		r.Group(func(sr chi.Router) {
			sr.Use(adminapi.RequireStepUp(h.Pool, 0))
			sr.Post("/withdrawals/{id}/approve", h.ApproveWithdrawal)
			sr.Post("/withdrawals/{id}/reject", h.RejectWithdrawal)
			sr.Post("/deposits/{id}/reverse", h.ReverseDeposit)
			sr.Post("/users/{id}/kyc/approve", h.ApproveUserKYC)
			sr.Post("/users/{id}/kyc/reject", h.RejectUserKYC)
			sr.Post("/finance/provider-fees", h.PostProviderFee)
			sr.Post("/finance/failed-jobs/{id}/resolve", h.ResolveFinancialFailedJob)
		})
		r.Post("/compliance/player-erasure", h.EnqueuePlayerErasure)
		r.Route("/security/break-glass", func(sr chi.Router) {
			sr.Get("/grants", h.ListBreakGlassGrants)
			sr.Post("/grants", h.CreateBreakGlassGrant)
			sr.Post("/grants/{id}/approve", h.ApproveBreakGlassGrant)
			sr.Post("/grants/{id}/reject", h.RejectBreakGlassGrant)
			sr.Post("/grants/{id}/consume", h.ConsumeBreakGlassGrant)
		})
		r.Patch("/settings", h.PatchSettings)
		r.Put("/content/{key}", h.PutContent)
		r.Post("/content/upload", h.UploadContentImage)
	})
	if h.ChatHub != nil {
		r.Route("/chat", func(sr chi.Router) {
			chat.MountStaffRoutes(sr, h.ChatHub, h.Pool)
		})
	}
	h.mountChallenges(r)
	h.mountBonusHub(r)
}

// MountPublicRoutes registers content/settings endpoints that do NOT require admin auth.
// Call this on the public (player-facing) router, outside the admin middleware group.
func (h *Handler) MountPublicRoutes(r chi.Router) {
	r.Get("/settings/public", h.GetSettingsPublic)
	r.Get("/social-proof", h.GetSocialProof)
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
	list := make([]map[string]any, 0)
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

func (h *Handler) ListPaymentDepositIntents(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id::text, user_id::text, status, COALESCE(currency,''), COALESCE(provider_order_id,''), created_at,
			COALESCE(internal_ledger_currency,''), COALESCE(internal_credited_minor, 0),
			COALESCE(credited_amount_minor, 0),
			COALESCE(fx_internal_per_crypto_num, 0), COALESCE(fx_internal_per_crypto_den, 0),
			COALESCE(duplicate_callback_count, 0)
		FROM payment_deposit_intents
		WHERE provider = 'passimpay'
		ORDER BY created_at DESC NULLS LAST LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, uid, status, ccy, orderID string
		var ct time.Time
		var internalCcy string
		var internalCred, cryptoCred, fxNum, fxDen int64
		var dupCb int
		if err := rows.Scan(&id, &uid, &status, &ccy, &orderID, &ct, &internalCcy, &internalCred, &cryptoCred, &fxNum, &fxDen, &dupCb); err != nil {
			continue
		}
		row := map[string]any{
			"id": id, "user_id": uid, "status": status,
			"crypto_asset":                ccy,
			"provider_order_id":           orderID,
			"created_at":                  ct.UTC().Format(time.RFC3339),
			"internal_ledger_currency":    internalCcy,
			"internal_credited_minor":     internalCred,
			"crypto_credited_minor_total": cryptoCred,
			"fx_internal_per_crypto_num":  fxNum,
			"fx_internal_per_crypto_den":  fxDen,
			"duplicate_callback_count":    dupCb,
		}
		list = append(list, row)
	}
	writeJSON(w, map[string]any{"payments": list})
}

func (h *Handler) ListPaymentWithdrawals(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	rows, err := h.Pool.Query(r.Context(), `
		SELECT withdrawal_id::text, user_id::text, status,
			COALESCE(currency,''),
			COALESCE(internal_ledger_currency,''),
			COALESCE(internal_amount_minor, amount_minor),
			COALESCE(amount_minor, 0),
			COALESCE(crypto_payout_minor, 0),
			created_at
		FROM payment_withdrawals
		WHERE provider = 'passimpay'
		ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, uid, status, payoutCcy, internalCcy string
		var internalAmt, legacyAmt, cryptoPayout int64
		var ct time.Time
		if err := rows.Scan(&id, &uid, &status, &payoutCcy, &internalCcy, &internalAmt, &legacyAmt, &cryptoPayout, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id":                       id,
			"user_id":                  uid,
			"status":                   status,
			"payout_crypto_asset":      payoutCcy,
			"internal_ledger_currency": internalCcy,
			"internal_amount_minor":    internalAmt,
			"crypto_payout_minor":      cryptoPayout,
			"created_at":               ct.UTC().Format(time.RFC3339),
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
