package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/webhooks"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) OpsSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var whPending, missingWallet, wdOpen, ledgerRows, wfJobs int64
	var bonusOutboxPending, bonusOutboxDLQ int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)::bigint FROM fystack_webhook_deliveries WHERE processed = false),
			(SELECT COUNT(*)::bigint FROM users u WHERE NOT EXISTS (SELECT 1 FROM fystack_wallets w WHERE w.user_id = u.id)),
			(SELECT COUNT(*)::bigint FROM fystack_withdrawals WHERE status IN ('pending','submitted','pending_approval','executed')),
			(SELECT COUNT(*)::bigint FROM ledger_entries),
			(SELECT COUNT(*)::bigint FROM worker_failed_jobs WHERE resolved_at IS NULL),
			(SELECT COUNT(*)::bigint FROM bonus_outbox WHERE processed_at IS NULL AND dlq_at IS NULL),
			(SELECT COUNT(*)::bigint FROM bonus_outbox WHERE processed_at IS NULL AND dlq_at IS NOT NULL)
	`).Scan(&whPending, &missingWallet, &wdOpen, &ledgerRows, &wfJobs, &bonusOutboxPending, &bonusOutboxDLQ)

	out := map[string]any{
		"webhook_deliveries_pending":    whPending,
		"users_missing_fystack_wallet":  missingWallet,
		"withdrawals_in_flight":         wdOpen,
		"ledger_entries_total":          ledgerRows,
		"worker_failed_jobs_unresolved": wfJobs,
		"bonus_outbox_pending_delivery": bonusOutboxPending,
		"bonus_outbox_dead_letter":      bonusOutboxDLQ,
		"process_metrics":               obs.Snapshot(),
	}
	if h.Redis != nil {
		if n, err := h.Redis.LLen(ctx, "casino:jobs").Result(); err == nil {
			out["redis_queue_depth"] = n
		}
	}
	writeJSON(w, out)
}

// GetDepositAssets returns which canonical deposit-asset keys are configured (no UUID values).
func (h *Handler) GetDepositAssets(w http.ResponseWriter, r *http.Request) {
	out := map[string]bool{}
	if h.Cfg != nil {
		for _, k := range config.FystackDepositAssetCanonicalKeys() {
			out[k] = h.Cfg.DepositAssetKeyConfigured(k)
		}
		out["default_legacy"] = strings.TrimSpace(h.Cfg.FystackDepositAssetID) != ""
	}
	writeJSON(w, map[string]any{"configured": out})
}

func (h *Handler) GetPaymentFlags(w http.ResponseWriter, r *http.Request) {
	f, err := paymentflags.Load(r.Context(), h.Pool)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "flags load failed")
		return
	}
	writeJSON(w, map[string]any{
		"deposits_enabled":         f.DepositsEnabled,
		"withdrawals_enabled":      f.WithdrawalsEnabled,
		"real_play_enabled":        f.RealPlayEnabled,
		"bonuses_enabled":          f.BonusesEnabled,
		"automated_grants_enabled": f.AutomatedGrantsEnabled,
	})
}

type patchFlagsReq struct {
	DepositsEnabled        *bool `json:"deposits_enabled"`
	WithdrawalsEnabled     *bool `json:"withdrawals_enabled"`
	RealPlayEnabled        *bool `json:"real_play_enabled"`
	BonusesEnabled         *bool `json:"bonuses_enabled"`
	AutomatedGrantsEnabled *bool `json:"automated_grants_enabled"`
}

func (h *Handler) PatchPaymentFlags(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	var body patchFlagsReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	f, err := paymentflags.Load(r.Context(), h.Pool)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "flags load failed")
		return
	}
	if body.DepositsEnabled != nil {
		f.DepositsEnabled = *body.DepositsEnabled
	}
	if body.WithdrawalsEnabled != nil {
		f.WithdrawalsEnabled = *body.WithdrawalsEnabled
	}
	if body.RealPlayEnabled != nil {
		f.RealPlayEnabled = *body.RealPlayEnabled
	}
	if body.BonusesEnabled != nil {
		f.BonusesEnabled = *body.BonusesEnabled
	}
	if body.AutomatedGrantsEnabled != nil {
		f.AutomatedGrantsEnabled = *body.AutomatedGrantsEnabled
	}
	_, err = h.Pool.Exec(r.Context(), `
		UPDATE payment_ops_flags SET
			deposits_enabled = $1,
			withdrawals_enabled = $2,
			real_play_enabled = $3,
			bonuses_enabled = $4,
			automated_grants_enabled = $5,
			updated_at = now()
		WHERE id = 1
	`, f.DepositsEnabled, f.WithdrawalsEnabled, f.RealPlayEnabled, f.BonusesEnabled, f.AutomatedGrantsEnabled)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}
	meta, _ := json.Marshal(body)
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'ops.payment_flags', 'payment_ops_flags', $2)
	`, staffID, meta)
	writeJSON(w, map[string]any{
		"deposits_enabled": f.DepositsEnabled, "withdrawals_enabled": f.WithdrawalsEnabled, "real_play_enabled": f.RealPlayEnabled,
		"bonuses_enabled": f.BonusesEnabled, "automated_grants_enabled": f.AutomatedGrantsEnabled,
	})
}

func (h *Handler) PostOpsReconcileFystack(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	n, err := webhooks.ReconcileStaleFystackDeliveries(r.Context(), h.Pool)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "reconcile_failed", err.Error())
		return
	}
	meta, _ := json.Marshal(map[string]any{"rows_touched": n})
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'ops.reconcile_fystack', 'fystack_webhook_deliveries', $2)
	`, staffID, meta)
	writeJSON(w, map[string]any{"processed": n})
}

type provisionWalletReq struct {
	UserID string `json:"user_id"`
}

func (h *Handler) PostOpsProvisionFystackWallet(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	if h.Fystack == nil || h.Cfg == nil || !h.Cfg.FystackConfigured() {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "fystack_unconfigured", "Fystack client not configured")
		return
	}
	var body provisionWalletReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.UserID) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "user_id required")
		return
	}
	p := &fystack.WalletProvisioner{Pool: h.Pool, Client: h.Fystack}
	if err := p.Provision(r.Context(), body.UserID); err != nil {
		adminapi.WriteError(w, http.StatusBadGateway, "provision_failed", err.Error())
		return
	}
	meta, _ := json.Marshal(body)
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'ops.provision_fystack_wallet', 'user', $2)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true})
}

func (h *Handler) ListFystackWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	limit := 100
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	only := strings.TrimSpace(r.URL.Query().Get("processed"))
	q := `
		SELECT id, dedupe_key, event_type, resource_id, processed, created_at
		FROM fystack_webhook_deliveries`
	args := []any{}
	if only == "true" || only == "false" {
		q += ` WHERE processed = $1`
		args = append(args, only == "true")
		q += ` ORDER BY id DESC LIMIT $2`
		args = append(args, limit)
	} else {
		q += ` ORDER BY id DESC LIMIT $1`
		args = append(args, limit)
	}
	rows, err := h.Pool.Query(ctx, q, args...)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var dk, et, rid string
		var proc bool
		var ct string
		if err := rows.Scan(&id, &dk, &et, &rid, &proc, &ct); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "dedupe_key": dk, "event_type": et, "resource_id": rid,
			"processed": proc, "created_at": ct,
		})
	}
	writeJSON(w, map[string]any{"deliveries": list})
}

func (h *Handler) PostReprocessFystackWebhookDelivery(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}
	idStr := strings.TrimSpace(chi.URLParam(r, "id"))
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid id")
		return
	}
	if h.Redis != nil {
		raw, _ := json.Marshal(map[string]int64{"delivery_id": id})
		if err := jobs.Enqueue(r.Context(), h.Redis, jobs.Job{Type: "fystack_webhook", Data: raw}); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "enqueue_failed", err.Error())
			return
		}
	} else {
		if _, err := webhooks.ProcessFystackWebhookDelivery(r.Context(), h.Pool, id); err != nil {
			adminapi.WriteError(w, http.StatusBadGateway, "process_failed", err.Error())
			return
		}
	}
	meta, _ := json.Marshal(map[string]any{"delivery_id": id})
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'ops.fystack_webhook_reprocess', 'fystack_webhook_deliveries', $2)
	`, staffID, meta)
	writeJSON(w, map[string]any{"ok": true, "delivery_id": id})
}
