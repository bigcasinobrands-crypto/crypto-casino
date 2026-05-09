package referrals

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/affiliate"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/playercookies"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostAttributionHandler POST /v1/referrals/attribution — validates code and sets HttpOnly pending cookie.
func PostAttributionHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg == nil || pool == nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "not configured")
			return
		}
		var body struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
			return
		}
		code := affiliate.NormalizeReferralCode(body.Code)
		if code == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_code", "code required")
			return
		}
		var one int
		err := pool.QueryRow(r.Context(), `
			SELECT 1 FROM affiliate_partners
			WHERE upper(trim(referral_code)) = $1 AND status = 'active'
			LIMIT 1
		`, code).Scan(&one)
		if err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "unknown_code", "referral code not found")
			return
		}
		playercookies.SetReferralPending(w, cfg, code)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

// GetMeHandler GET /v1/referrals/me
func GetMeHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		summary, err := affiliate.HubReferralSummary(r.Context(), pool, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "referral summary failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(summary)
	}
}

// PostClaimHandler POST /v1/referrals/claim — pay pending grants to cash (up to 50 lines).
func PostClaimHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		n, err := affiliate.PayPendingGrantsForPartnerUser(r.Context(), pool, uid, 50)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "claim failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "grants_paid": n})
	}
}

// GetReferredHandler GET /v1/referrals/referred?q=&page=&limit=
func GetReferredHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		ctx := r.Context()
		_, _, err := affiliate.EnsureAffiliatePartner(ctx, pool, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "partner lookup failed")
			return
		}
		var partnerID string
		_ = pool.QueryRow(ctx, `SELECT id::text FROM affiliate_partners WHERE user_id = $1::uuid`, uid).Scan(&partnerID)
		if partnerID == "" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"rows": []any{}, "total": 0})
			return
		}

		q := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("q")))
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit < 1 || limit > 100 {
			limit = 20
		}
		off := (page - 1) * limit

		var total int64
		countSQL := `
			SELECT COUNT(*)::bigint FROM affiliate_referrals ar
			JOIN users u ON u.id = ar.user_id
			WHERE ar.partner_id = $1::uuid
			  AND ($2 = '' OR lower(COALESCE(u.username, '')) LIKE '%' || $2 || '%' OR lower(u.id::text) LIKE '%' || $2 || '%')
		`
		_ = pool.QueryRow(ctx, countSQL, partnerID, q).Scan(&total)

		rows, err := pool.Query(ctx, `
			SELECT u.id::text,
			       COALESCE(u.username, ''),
			       u.created_at,
			       COALESCE(vt.name, ''),
			       COALESCE((
			         SELECT COALESCE(SUM(ABS(le.amount_minor)), 0)::bigint
			         FROM ledger_entries le
			         WHERE le.user_id = u.id AND le.pocket = 'cash'
			           AND le.entry_type IN ('game.debit','game.bet','sportsbook.debit')
			       ), 0),
			       COALESCE((
			         SELECT SUM(g.commission_minor)::bigint
			         FROM affiliate_commission_grants g
			         WHERE g.partner_id = $1::uuid
			           AND g.metadata->>'referee_user_id' = u.id::text
			       ), 0)
			FROM affiliate_referrals ar
			JOIN users u ON u.id = ar.user_id
			LEFT JOIN player_vip_state pvs ON pvs.user_id = u.id
			LEFT JOIN vip_tiers vt ON vt.id = pvs.tier_id
			WHERE ar.partner_id = $1::uuid
			  AND ($2 = '' OR lower(COALESCE(u.username, '')) LIKE '%' || $2 || '%'
			       OR lower(u.id::text) LIKE '%' || $2 || '%')
			ORDER BY ar.attributed_at DESC
			LIMIT $3 OFFSET $4
		`, partnerID, q, limit, off)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()

		type row struct {
			UserID        string `json:"user_id"`
			Username      string `json:"username"`
			JoinedAt      string `json:"joined_at"`
			VipTier       string `json:"vip_tier"`
			TotalWagered  int64  `json:"total_wagered_minor"`
			Commission    int64  `json:"commission_earned_minor"`
		}
		var outRows []row
		for rows.Next() {
			var rw row
			var joined time.Time
			if err := rows.Scan(&rw.UserID, &rw.Username, &joined, &rw.VipTier, &rw.TotalWagered, &rw.Commission); err != nil {
				continue
			}
			rw.JoinedAt = joined.UTC().Format(time.RFC3339)
			outRows = append(outRows, rw)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"rows":  outRows,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}

// GetEarningsSeriesHandler GET /v1/referrals/earnings-series?range=7d|14d|30d
func GetEarningsSeriesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		ctx := r.Context()
		var partnerID string
		_ = pool.QueryRow(ctx, `SELECT id::text FROM affiliate_partners WHERE user_id = $1::uuid`, uid).Scan(&partnerID)
		if partnerID == "" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"points": []any{}})
			return
		}
		rng := strings.TrimSpace(r.URL.Query().Get("range"))
		days := 7
		switch rng {
		case "14d":
			days = 14
		case "30d":
			days = 30
		case "7d", "":
			days = 7
		}
		since := time.Now().UTC().AddDate(0, 0, -days)

		// Accrued commission grants (pending+paid) by UTC day — finance view of "earnings".
		rows, err := pool.Query(ctx, `
			SELECT (g.created_at AT TIME ZONE 'UTC')::date AS d,
			       SUM(g.commission_minor)::bigint
			FROM affiliate_commission_grants g
			WHERE g.partner_id = $1::uuid
			  AND g.created_at >= $2
			GROUP BY 1
			ORDER BY 1 ASC
		`, partnerID, since)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "series failed")
			return
		}
		defer rows.Close()
		type pt struct {
			Date   string `json:"date"`
			Amount int64  `json:"amount_minor"`
		}
		var pts []pt
		for rows.Next() {
			var d time.Time
			var amt int64
			if err := rows.Scan(&d, &amt); err != nil {
				continue
			}
			pts = append(pts, pt{Date: d.Format("2006-01-02"), Amount: amt})
		}

		// Cash paid (payout) by day
		prows, err := pool.Query(ctx, `
			SELECT (le.created_at AT TIME ZONE 'UTC')::date AS d,
			       SUM(le.amount_minor)::bigint
			FROM ledger_entries le
			WHERE le.user_id = $1::uuid
			  AND le.entry_type = $2
			  AND le.amount_minor > 0
			  AND le.created_at >= $3
			GROUP BY 1
			ORDER BY 1 ASC
		`, uid, ledger.EntryTypeAffiliatePayout, since)
		var paidPts []pt
		if err == nil {
			defer prows.Close()
			for prows.Next() {
				var d time.Time
				var amt int64
				if err := prows.Scan(&d, &amt); err != nil {
					continue
				}
				paidPts = append(paidPts, pt{Date: d.Format("2006-01-02"), Amount: amt})
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"accrued_daily": pts,
			"payout_daily":  paidPts,
		})
	}
}
