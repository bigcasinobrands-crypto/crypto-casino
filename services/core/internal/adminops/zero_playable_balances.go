package adminops

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/ledger"
)

const zeroPlayableConfirmPhrase = "ZERO_ALL_PLAYABLE_BALANCES"

type zeroPlayableReq struct {
	Confirm string `json:"confirm"`
	DryRun  bool   `json:"dry_run"`
}

type zeroPlayableAdjustment struct {
	UserID       string `json:"user_id"`
	Pocket       string `json:"pocket"`
	Currency     string `json:"currency"`
	BeforeMinor  int64  `json:"before_minor"`
	DeltaMinor   int64  `json:"delta_minor"`
	Applied        bool `json:"applied"`
	IdempotentSkip bool `json:"idempotent_skip"` // true when ON CONFLICT skipped (same idempotency key already existed)
}

// ZeroPlayableBalances POST /v1/admin/ops/zero-playable-balances
//
// Superadmin only. Requires config AllowAdminZeroPlayableBalances (ALLOW_ADMIN_ZERO_PLAYABLE_BALANCES=1).
// Body: {"confirm":"ZERO_ALL_PLAYABLE_BALANCES","dry_run":false}
//
// Posts one ledger row per (user, pocket, currency) where sum(cash)+sum(bonus_locked) is non-zero for that pocket,
// with entry_type admin.playable_zero and amount = -current_balance so the new sum is zero. Does not delete rows.
// Blocks if any player has non-zero net pending_withdrawal ledger balance.
//
// Historical dashboard GGR / 30d wagered are unchanged (they sum game/sportsbook lines, not this admin type).
func (h *Handler) ZeroPlayableBalances(w http.ResponseWriter, r *http.Request) {
	if h.Cfg == nil || !h.Cfg.AllowAdminZeroPlayableBalances {
		adminapi.WriteError(w, http.StatusForbidden, "feature_disabled",
			"Set ALLOW_ADMIN_ZERO_PLAYABLE_BALANCES=1 on the API process after you accept the compliance risk, then redeploy.")
		return
	}
	if r.Method != http.MethodPost {
		adminapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST only")
		return
	}
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	staff = strings.TrimSpace(staff)
	if staff == "" {
		adminapi.WriteError(w, http.StatusForbidden, "no_staff", "no staff identity on request")
		return
	}

	var req zeroPlayableReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "expected JSON body")
		return
	}
	if strings.TrimSpace(req.Confirm) != zeroPlayableConfirmPhrase {
		adminapi.WriteError(w, http.StatusBadRequest, "confirm_required",
			`Send {"confirm":"ZERO_ALL_PLAYABLE_BALANCES","dry_run":false} exactly.`)
		return
	}

	ctx := r.Context()
	house := ledger.HouseUserID(h.Cfg)
	fallbackCCY := strings.ToUpper(strings.TrimSpace(h.Cfg.BlueOceanCurrency))
	if fallbackCCY == "" {
		fallbackCCY = "EUR"
	}

	var pendingN int
	err := h.Pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM (
			SELECT user_id,
			       COALESCE(NULLIF(TRIM(BOTH FROM currency), ''), $1::text) AS ccy
			FROM ledger_entries
			WHERE pocket = 'pending_withdrawal'
			GROUP BY user_id, COALESCE(NULLIF(TRIM(BOTH FROM currency), ''), $1::text)
			HAVING COALESCE(SUM(amount_minor), 0) <> 0
		) x
	`, fallbackCCY).Scan(&pendingN)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "pending_check_failed", err.Error())
		return
	}
	if pendingN > 0 {
		adminapi.WriteError(w, http.StatusConflict, "pending_withdrawals_nonzero",
			fmt.Sprintf("There are %d user/currency bucket(s) with non-zero pending_withdrawal ledger balance — resolve or wait for settlement first.", pendingN))
		return
	}

	rows, err := h.Pool.Query(ctx, `
		SELECT user_id::text,
		       pocket,
		       COALESCE(NULLIF(TRIM(BOTH FROM currency), ''), $1::text) AS ccy,
		       COALESCE(SUM(amount_minor), 0)::bigint AS bal
		FROM ledger_entries
		WHERE pocket IN ('cash', 'bonus_locked')
		  AND user_id <> $2::uuid
		GROUP BY user_id, pocket, COALESCE(NULLIF(TRIM(BOTH FROM currency), ''), $1::text)
		HAVING COALESCE(SUM(amount_minor), 0) <> 0
		ORDER BY user_id, pocket, ccy
	`, fallbackCCY, house)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "balance_query_failed", err.Error())
		return
	}
	defer rows.Close()

	type rowKey struct {
		uid    string
		pocket string
		ccy    string
		bal    int64
	}
	var list []rowKey
	for rows.Next() {
		var uid, pocket, ccy string
		var bal int64
		if err := rows.Scan(&uid, &pocket, &ccy, &bal); err != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "balance_scan_failed", err.Error())
			return
		}
		list = append(list, rowKey{uid, pocket, ccy, bal})
	}
	if err := rows.Err(); err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "balance_rows_failed", err.Error())
		return
	}

	out := make([]zeroPlayableAdjustment, 0, len(list))
	for _, rk := range list {
		delta := -rk.bal
		adj := zeroPlayableAdjustment{
			UserID:      rk.uid,
			Pocket:      rk.pocket,
			Currency:    rk.ccy,
			BeforeMinor: rk.bal,
			DeltaMinor:  delta,
		}
		if req.DryRun {
			adj.Applied = false
			out = append(out, adj)
			continue
		}
		pocket := ledger.NormalizePocket(rk.pocket)
		idem := fmt.Sprintf("admin:playable-zero:%s:%s:%s:%d", rk.uid, pocket, rk.ccy, rk.bal)
		meta := map[string]any{
			"op":      "zero_playable_balance",
			"staff":   staff,
			"pocket":  pocket,
			"before":  rk.bal,
			"dry_run": false,
		}
		inserted, aerr := ledger.ApplyCreditWithPocket(ctx, h.Pool, rk.uid, rk.ccy, ledger.EntryTypeAdminPlayableZero, idem, delta, pocket, meta)
		if aerr != nil {
			adminapi.WriteError(w, http.StatusInternalServerError, "ledger_adjust_failed",
				fmt.Sprintf("user %s %s %s: %v", rk.uid, pocket, rk.ccy, aerr))
			return
		}
		adj.Applied = inserted
		adj.IdempotentSkip = !inserted
		out = append(out, adj)
	}

	payload, _ := json.Marshal(map[string]any{
		"adjustments": out,
		"dry_run":     req.DryRun,
		"count":       len(out),
	})
	h.auditExec(ctx, "ops.zero_playable_balances", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES (NULLIF($1,'')::uuid, 'ops.zero_playable_balances', 'ledger', $2::jsonb)
	`, staff, string(payload))

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":           true,
		"dry_run":      req.DryRun,
		"adjustments":  out,
		"note":         "Player cash and bonus_locked balances are zeroed via new ledger rows. Metrics such as 30d GGR, total wagered, and active players are historical sums of game/sportsbook activity and are not reset by this operation.",
		"audit_logged": true,
	})
}
