package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
)

// Manual provider-fee posting (E-6).
//
// Most provider fees come in via the payment-rail webhook (PassimPay reports
// the network commission on each callback). But game providers like
// BlueOcean and Oddin settle fees out-of-band — typically a monthly invoice
// for the platform fee + RTP-tax. This endpoint lets the finance team post
// those invoices directly to the central ledger as `provider.fee` debits on
// the house user, so NGR analytics stay accurate without a parallel
// invoicing system.
//
// Required:
//   - role superadmin (mounted under the superadmin group)
//   - a non-empty `idempotency_key` so re-submitting the same invoice does
//     not double-charge

type postProviderFeeReq struct {
	Provider       string         `json:"provider"`
	Currency       string         `json:"currency"`
	AmountMinor    int64          `json:"amount_minor"`
	IdempotencyKey string         `json:"idempotency_key"`
	Note           string         `json:"note"`
	Metadata       map[string]any `json:"metadata"`
}

// PostProviderFee accepts a JSON body and writes a provider.fee ledger debit
// against the configured house user. Always returns 200 with `inserted=true`
// on first call and `inserted=false` on a duplicate idempotency key, so the
// admin UI can show "already recorded" without errorring out.
func (h *Handler) PostProviderFee(w http.ResponseWriter, r *http.Request) {
	var req postProviderFeeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	currency := strings.ToUpper(strings.TrimSpace(req.Currency))
	idem := strings.TrimSpace(req.IdempotencyKey)
	switch {
	case provider == "":
		adminapi.WriteError(w, http.StatusBadRequest, "provider_required", "provider is required")
		return
	case currency == "":
		adminapi.WriteError(w, http.StatusBadRequest, "currency_required", "currency is required")
		return
	case idem == "":
		adminapi.WriteError(w, http.StatusBadRequest, "idempotency_required", "idempotency_key is required")
		return
	case req.AmountMinor <= 0:
		adminapi.WriteError(w, http.StatusBadRequest, "amount_required", "amount_minor must be > 0")
		return
	}

	staff, _ := adminapi.StaffIDFromContext(r.Context())
	staff = strings.TrimSpace(staff)

	meta := map[string]any{}
	for k, v := range req.Metadata {
		meta[k] = v
	}
	meta["posted_via"] = "admin"
	meta["staff_user_id"] = staff
	if note := strings.TrimSpace(req.Note); note != "" {
		meta["note"] = note
	}

	houseID := ledger.HouseUserID(h.Cfg)
	inserted, err := ledger.RecordProviderFee(r.Context(), h.Pool, houseID, currency, provider, idem, req.AmountMinor, meta)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "ledger_failed", err.Error())
		return
	}

	h.auditExec(r.Context(), "provider.fee.post", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, payload)
		VALUES (NULLIF($1,'')::uuid, 'provider.fee.post', 'ledger', $2, jsonb_build_object(
			'provider', $3::text, 'currency', $4::text, 'amount_minor', $5::bigint,
			'idempotency_key', $6::text, 'note', $7::text, 'inserted', $8::boolean
		))
	`, staff, idem, provider, currency, req.AmountMinor, idem, strings.TrimSpace(req.Note), inserted)
	_ = adminapi.ConsumeStepUpForAction(r.Context(), h.Pool, "provider.fee.post")

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":              true,
		"inserted":        inserted,
		"idempotency_key": idem,
	})
}
