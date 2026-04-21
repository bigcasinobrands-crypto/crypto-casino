package adminops

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

// ComplianceExportUser returns bonuses, ledger sample, and staff audit rows mentioning the player (JSON download).
func (h *Handler) ComplianceExportUser(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "missing id")
		return
	}
	ctx := r.Context()
	var email string
	var created time.Time
	err := h.Pool.QueryRow(ctx, `SELECT email, created_at FROM users WHERE id = $1::uuid`, id).Scan(&email, &created)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}

	legRows, err := h.Pool.Query(ctx, `
		SELECT id, amount_minor, currency, entry_type, idempotency_key, pocket, created_at
		FROM ledger_entries WHERE user_id = $1::uuid ORDER BY id DESC LIMIT 500
	`, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "ledger query failed")
		return
	}
	defer legRows.Close()
	var ledger []map[string]any
	for legRows.Next() {
		var lid int64
		var amt int64
		var ccy, et, idem, pocket string
		var ct time.Time
		if err := legRows.Scan(&lid, &amt, &ccy, &et, &idem, &pocket, &ct); err != nil {
			continue
		}
		ledger = append(ledger, map[string]any{
			"id": lid, "amount_minor": amt, "currency": ccy, "entry_type": et,
			"idempotency_key": idem, "pocket": pocket, "created_at": ct.UTC().Format(time.RFC3339),
		})
	}

	biRows, err := h.Pool.Query(ctx, `
		SELECT id::text, promotion_version_id, status, granted_amount_minor, currency,
			wr_required_minor, wr_contributed_minor, COALESCE(terms_version,''), idempotency_key, created_at
		FROM user_bonus_instances WHERE user_id = $1::uuid ORDER BY created_at DESC
	`, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "bonus query failed")
		return
	}
	defer biRows.Close()
	var bonuses []map[string]any
	for biRows.Next() {
		var bid, idem string
		var pvid int64
		var st, ccy, terms string
		var g, wr, wc int64
		var ct time.Time
		if err := biRows.Scan(&bid, &pvid, &st, &g, &ccy, &wr, &wc, &terms, &idem, &ct); err != nil {
			continue
		}
		bonuses = append(bonuses, map[string]any{
			"id": bid, "promotion_version_id": pvid, "status": st,
			"granted_amount_minor": g, "currency": ccy,
			"wr_required_minor": wr, "wr_contributed_minor": wc,
			"terms_hash": terms, "idempotency_key": idem,
			"created_at": ct.UTC().Format(time.RFC3339),
		})
	}

	audRows, err := h.Pool.Query(ctx, `
		SELECT id, staff_user_id::text, action, target_type, target_id, meta, created_at
		FROM admin_audit_log
		WHERE target_id = $1 OR meta::text ILIKE '%' || $1 || '%'
		ORDER BY id DESC LIMIT 200
	`, id)
	var audit []map[string]any
	if err == nil {
		defer audRows.Close()
		for audRows.Next() {
			var aid int64
			var staff, action, tt, tid string
			var meta []byte
			var ct time.Time
			if err := audRows.Scan(&aid, &staff, &action, &tt, &tid, &meta, &ct); err != nil {
				continue
			}
			var metaObj any
			_ = json.Unmarshal(meta, &metaObj)
			audit = append(audit, map[string]any{
				"id": aid, "staff_user_id": staff, "action": action,
				"target_type": tt, "target_id": tid, "meta": metaObj,
				"created_at": ct.UTC().Format(time.RFC3339),
			})
		}
	}

	out := map[string]any{
		"export_kind":            "player_compliance_v1",
		"user_id":                id,
		"email":                  email,
		"created_at":             created.UTC().Format(time.RFC3339),
		"ledger_entries_sample":  ledger,
		"bonus_instances":        bonuses,
		"staff_audit_related":    audit,
		"retention_note":         "See docs/privacy-retention.md; expand per legal policy.",
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=compliance-"+id+".json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
}

// UserBonusRiskDecisions lists recorded bonus risk / eligibility decisions for a player.
func (h *Handler) UserBonusRiskDecisions(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "missing id")
		return
	}
	rows, err := h.Pool.Query(r.Context(), `
		SELECT id, promotion_version_id, decision, rule_codes, inputs, created_at
		FROM bonus_risk_decisions WHERE user_id = $1::uuid ORDER BY id DESC LIMIT 100
	`, id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var rid int64
		var pvid *int64
		var dec string
		var codes []string
		var inputs []byte
		var ct time.Time
		if err := rows.Scan(&rid, &pvid, &dec, &codes, &inputs, &ct); err != nil {
			continue
		}
		var inObj any
		_ = json.Unmarshal(inputs, &inObj)
		item := map[string]any{
			"id": rid, "decision": dec, "rule_codes": codes, "inputs": inObj,
			"created_at": ct.UTC().Format(time.RFC3339),
		}
		if pvid != nil {
			item["promotion_version_id"] = *pvid
		}
		list = append(list, item)
	}
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, map[string]any{"decisions": list})
}
