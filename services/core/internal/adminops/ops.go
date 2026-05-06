package adminops

import (
	"encoding/json"
	"net/http"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/paymentflags"
)

func (h *Handler) OpsSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var cbPending, paymentGapPlaceholder, wdOpen, ledgerRows, wfJobs int64
	var bonusOutboxPending, bonusOutboxDLQ int64
	_ = h.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)::bigint FROM processed_callbacks WHERE processed_at IS NULL),
			(SELECT 0::bigint),
			(SELECT COUNT(*)::bigint FROM payment_withdrawals WHERE provider = 'passimpay' AND status IN ('LEDGER_LOCKED','SUBMITTED_TO_PROVIDER')),
			(SELECT COUNT(*)::bigint FROM ledger_entries),
			(SELECT COUNT(*)::bigint FROM worker_failed_jobs WHERE resolved_at IS NULL),
			(SELECT COUNT(*)::bigint FROM bonus_outbox WHERE processed_at IS NULL AND dlq_at IS NULL),
			(SELECT COUNT(*)::bigint FROM bonus_outbox WHERE processed_at IS NULL AND dlq_at IS NOT NULL)
	`).Scan(&cbPending, &paymentGapPlaceholder, &wdOpen, &ledgerRows, &wfJobs, &bonusOutboxPending, &bonusOutboxDLQ)

	out := map[string]any{
		"webhook_deliveries_pending":    cbPending,
		"users_missing_payment_wallet":  paymentGapPlaceholder,
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

// GetDepositAssets returns which canonical deposit-asset keys exist in payment_currencies for PassimPay.
func (h *Handler) GetDepositAssets(w http.ResponseWriter, r *http.Request) {
	out := map[string]bool{}
	for _, k := range config.DepositAssetCanonicalKeys() {
		sym, net := splitSymbolNetworkKey(k)
		var ok bool
		_ = h.Pool.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM payment_currencies
				WHERE provider = 'passimpay'
				  AND upper(trim(symbol)) = upper(trim($1))
				  AND upper(trim(coalesce(network,''))) = upper(trim($2))
				  AND deposit_enabled = true
			)
		`, sym, net).Scan(&ok)
		out[k] = ok
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
