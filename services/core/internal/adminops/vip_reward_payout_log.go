package adminops

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
)

func (h *Handler) listVIPRewardPayoutLog(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	if limit > 500 {
		limit = 500
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	status := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
	entryType := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("entry_type")))
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))

	rows, err := h.Pool.Query(r.Context(), `
		SELECT
			le.id,
			le.created_at,
			le.user_id::text,
			COALESCE(u.email, ''),
			le.entry_type,
			le.amount_minor,
			le.currency,
			le.idempotency_key,
			REPLACE(le.idempotency_key, 'reward.cash:', '') AS reward_idempotency_key,
			COALESCE(fw.id, ''),
			COALESCE(fw.status, ''),
			COALESCE(fw.provider_withdrawal_id, ''),
			COALESCE(fw.destination, '')
		FROM ledger_entries le
		LEFT JOIN users u ON u.id = le.user_id
		LEFT JOIN fystack_withdrawals fw
			ON fw.idempotency_key = REPLACE(le.idempotency_key, 'reward.cash:', '')
		WHERE le.entry_type IN ('promo.rakeback', 'promo.daily_hunt_cash', 'vip.level_up_cash')
			AND ($1 = '' OR le.user_id::text = $1)
			AND ($2 = '' OR le.entry_type = $2)
			AND ($3 = '' OR COALESCE(fw.status, '') = $3)
			AND (
				$4 = '' OR
				le.user_id::text ILIKE '%' || $4 || '%' OR
				COALESCE(u.email, '') ILIKE '%' || $4 || '%' OR
				le.entry_type ILIKE '%' || $4 || '%' OR
				REPLACE(le.idempotency_key, 'reward.cash:', '') ILIKE '%' || $4 || '%' OR
				COALESCE(fw.id, '') ILIKE '%' || $4 || '%' OR
				COALESCE(fw.provider_withdrawal_id, '') ILIKE '%' || $4 || '%'
			)
		ORDER BY le.id DESC
		LIMIT $5
	`, userID, entryType, status, q, limit)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "payout log query failed")
		return
	}
	defer rows.Close()

	var list []map[string]any
	for rows.Next() {
		var ledgerID int64
		var createdAt time.Time
		var uid, email, etype, ccy, ledgerIdem, rewardIdem string
		var amountMinor int64
		var wid, wstatus, providerWid, destination string
		if err := rows.Scan(
			&ledgerID, &createdAt, &uid, &email, &etype, &amountMinor, &ccy,
			&ledgerIdem, &rewardIdem, &wid, &wstatus, &providerWid, &destination,
		); err != nil {
			continue
		}
		row := map[string]any{
			"ledger_id":               strconv.FormatInt(ledgerID, 10),
			"created_at":              createdAt.UTC().Format(time.RFC3339),
			"user_id":                 uid,
			"email":                   email,
			"entry_type":              etype,
			"amount_minor":            amountMinor,
			"currency":                ccy,
			"ledger_idempotency_key":  ledgerIdem,
			"reward_idempotency_key":  rewardIdem,
			"withdrawal_id":           wid,
			"withdrawal_status":       wstatus,
			"provider_withdrawal_id":  providerWid,
			"destination":             destination,
		}
		list = append(list, row)
	}
	writeJSON(w, map[string]any{"payouts": list})
}
