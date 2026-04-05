package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/webhooks"
)

func (h *Handler) OpsSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var whPending, missingWallet, wdOpen, ledgerRows int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)::bigint FROM fystack_webhook_deliveries WHERE processed = false),
			(SELECT COUNT(*)::bigint FROM users u WHERE NOT EXISTS (SELECT 1 FROM fystack_wallets w WHERE w.user_id = u.id)),
			(SELECT COUNT(*)::bigint FROM fystack_withdrawals WHERE status IN ('pending','submitted','pending_approval','executed')),
			(SELECT COUNT(*)::bigint FROM ledger_entries)
	`).Scan(&whPending, &missingWallet, &wdOpen, &ledgerRows)

	out := map[string]any{
		"webhook_deliveries_pending": whPending,
		"users_missing_fystack_wallet": missingWallet,
		"withdrawals_in_flight":        wdOpen,
		"ledger_entries_total":         ledgerRows,
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
		"deposits_enabled":    f.DepositsEnabled,
		"withdrawals_enabled": f.WithdrawalsEnabled,
		"real_play_enabled":   f.RealPlayEnabled,
	})
}

type patchFlagsReq struct {
	DepositsEnabled    *bool `json:"deposits_enabled"`
	WithdrawalsEnabled *bool `json:"withdrawals_enabled"`
	RealPlayEnabled    *bool `json:"real_play_enabled"`
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
	_, err = h.Pool.Exec(r.Context(), `
		UPDATE payment_ops_flags SET
			deposits_enabled = $1,
			withdrawals_enabled = $2,
			real_play_enabled = $3,
			updated_at = now()
		WHERE id = 1
	`, f.DepositsEnabled, f.WithdrawalsEnabled, f.RealPlayEnabled)
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
