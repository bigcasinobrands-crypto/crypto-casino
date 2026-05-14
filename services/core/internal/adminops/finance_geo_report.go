package adminops

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FinanceGeoPayload is returned by GET /v1/admin/analytics/finance-geo.
// Deposits: deposit.credit (amount_minor > 0). deposit.checkout has no current writer.
// Withdrawals: PassimPay terminal success (COMPLETED/PAID) in the window (provider-confirmed), attributed
// from the earliest matching withdrawal.pending.settled ledger line for geo metadata.
// Country: metadata.geo_country (Fingerprint on-ledger) → metadata.attribution_country_iso2 →
// most recent traffic_sessions row with last_at <= ledger line time.
type FinanceGeoPayload struct {
	Period   string             `json:"period"`
	Notes    string             `json:"notes"`
	Rows     []FinanceGeoRow    `json:"rows"`
	Coverage FinanceGeoCoverage `json:"coverage"`
}

// FinanceGeoRow is one country × currency aggregate.
type FinanceGeoRow struct {
	ISO2             string `json:"iso2"`
	Name             string `json:"name"`
	Currency         string `json:"currency"`
	DepositsMinor    int64  `json:"deposits_minor"`
	WithdrawalsMinor int64  `json:"withdrawals_minor"`
	NetMinor         int64  `json:"net_minor"`
	DepositLines     int64  `json:"deposit_lines"`
	WithdrawalLines  int64  `json:"withdrawal_lines"`
}

// FinanceGeoCoverage summarizes how country was resolved across ledger lines in the window.
type FinanceGeoCoverage struct {
	TotalLines             int64   `json:"total_lines"`
	FingerprintLedgerLines int64   `json:"fingerprint_ledger_lines"`
	TrafficSessionLines    int64   `json:"traffic_session_lines"`
	LedgerExplicitLines    int64   `json:"ledger_explicit_lines"`
	UnknownSourceLines     int64   `json:"unknown_source_lines"`
	UnknownCountryLines    int64   `json:"unknown_country_lines"`
	CountryResolvedPct     float64 `json:"country_resolved_pct"`
}

func buildFinanceGeoFromDB(ctx context.Context, pool *pgxpool.Pool, start, end time.Time, label string) (FinanceGeoPayload, error) {
	const q = `
WITH deposit_lines AS (
  SELECT
    le.currency,
    le.entry_type,
    le.amount_minor,
    COALESCE(
      NULLIF(upper(btrim(le.metadata->>'geo_country')), ''),
      NULLIF(upper(btrim(le.metadata->>'attribution_country_iso2')), ''),
      NULLIF(upper(btrim(tr.country_iso2)), ''),
      'ZZ'
    ) AS country_iso2
  FROM ledger_entries le
  LEFT JOIN LATERAL (
    SELECT ts.country_iso2
    FROM traffic_sessions ts
    WHERE ts.user_id = le.user_id
      AND ts.last_at <= le.created_at
    ORDER BY ts.last_at DESC
    LIMIT 1
  ) tr ON true
  WHERE le.created_at >= $1 AND le.created_at < $2
    AND le.entry_type = 'deposit.credit' AND le.amount_minor > 0
),
withdrawal_lines AS (
  SELECT
    le.currency,
    le.entry_type,
    le.amount_minor,
    COALESCE(
      NULLIF(upper(btrim(le.metadata->>'geo_country')), ''),
      NULLIF(upper(btrim(le.metadata->>'attribution_country_iso2')), ''),
      NULLIF(upper(btrim(tr.country_iso2)), ''),
      'ZZ'
    ) AS country_iso2
  FROM payment_withdrawals w
  JOIN LATERAL (
    SELECT le2.*
    FROM ledger_entries le2
    WHERE le2.user_id = w.user_id
      AND le2.entry_type = 'withdrawal.pending.settled'
      AND le2.amount_minor < 0
      AND le2.metadata->>'provider_order_id' = w.provider_order_id
    ORDER BY le2.created_at ASC
    LIMIT 1
  ) le ON true
  LEFT JOIN LATERAL (
    SELECT ts.country_iso2
    FROM traffic_sessions ts
    WHERE ts.user_id = le.user_id
      AND ts.last_at <= le.created_at
    ORDER BY ts.last_at DESC
    LIMIT 1
  ) tr ON true
  WHERE w.provider = 'passimpay'
    AND w.status IN ('COMPLETED','PAID')
    AND w.updated_at >= $1 AND w.updated_at < $2
),
lined AS (
  SELECT * FROM deposit_lines
  UNION ALL
  SELECT * FROM withdrawal_lines
)
SELECT
  country_iso2,
  currency,
  COALESCE(SUM(CASE WHEN entry_type = 'deposit.credit' AND amount_minor > 0 THEN amount_minor ELSE 0 END), 0)::bigint AS deposits_minor,
  COALESCE(SUM(CASE WHEN entry_type = 'withdrawal.pending.settled' AND amount_minor < 0 THEN -amount_minor ELSE 0 END), 0)::bigint AS withdrawals_minor,
  COUNT(*) FILTER (WHERE entry_type = 'deposit.credit' AND amount_minor > 0)::bigint AS deposit_lines,
  COUNT(*) FILTER (WHERE entry_type = 'withdrawal.pending.settled' AND amount_minor < 0)::bigint AS withdrawal_lines
FROM lined
GROUP BY country_iso2, currency
ORDER BY country_iso2 ASC, currency ASC
`

	rows, err := pool.Query(ctx, q, start, end)
	if err != nil {
		return FinanceGeoPayload{}, err
	}
	defer rows.Close()

	var out []FinanceGeoRow
	for rows.Next() {
		var iso, ccy string
		var dep, wdr, depN, wdrN int64
		if err := rows.Scan(&iso, &ccy, &dep, &wdr, &depN, &wdrN); err != nil {
			return FinanceGeoPayload{}, err
		}
		ccy = strings.ToUpper(strings.TrimSpace(ccy))
		if ccy == "" {
			ccy = "?"
		}
		out = append(out, FinanceGeoRow{
			ISO2:             iso,
			Name:             countryDisplayName(iso),
			Currency:         ccy,
			DepositsMinor:    dep,
			WithdrawalsMinor: wdr,
			NetMinor:         dep - wdr,
			DepositLines:     depN,
			WithdrawalLines:  wdrN,
		})
	}
	if err := rows.Err(); err != nil {
		return FinanceGeoPayload{}, err
	}

	const covSQL = `
WITH deposit_lines AS (
  SELECT
    CASE
      WHEN NULLIF(upper(btrim(le.metadata->>'geo_country')), '') IS NOT NULL THEN 'fingerprint_ledger'
      WHEN NULLIF(upper(btrim(le.metadata->>'attribution_country_iso2')), '') IS NOT NULL THEN 'ledger_explicit'
      WHEN NULLIF(upper(btrim(tr.country_iso2)), '') IS NOT NULL THEN 'traffic_session'
      ELSE 'unknown'
    END AS src,
    COALESCE(
      NULLIF(upper(btrim(le.metadata->>'geo_country')), ''),
      NULLIF(upper(btrim(le.metadata->>'attribution_country_iso2')), ''),
      NULLIF(upper(btrim(tr.country_iso2)), ''),
      'ZZ'
    ) AS country_iso2
  FROM ledger_entries le
  LEFT JOIN LATERAL (
    SELECT ts.country_iso2
    FROM traffic_sessions ts
    WHERE ts.user_id = le.user_id
      AND ts.last_at <= le.created_at
    ORDER BY ts.last_at DESC
 LIMIT 1
  ) tr ON true
  WHERE le.created_at >= $1 AND le.created_at < $2
    AND le.entry_type = 'deposit.credit' AND le.amount_minor > 0
),
withdrawal_lines AS (
  SELECT
    CASE
      WHEN NULLIF(upper(btrim(le.metadata->>'geo_country')), '') IS NOT NULL THEN 'fingerprint_ledger'
      WHEN NULLIF(upper(btrim(le.metadata->>'attribution_country_iso2')), '') IS NOT NULL THEN 'ledger_explicit'
      WHEN NULLIF(upper(btrim(tr.country_iso2)), '') IS NOT NULL THEN 'traffic_session'
      ELSE 'unknown'
    END AS src,
    COALESCE(
      NULLIF(upper(btrim(le.metadata->>'geo_country')), ''),
      NULLIF(upper(btrim(le.metadata->>'attribution_country_iso2')), ''),
      NULLIF(upper(btrim(tr.country_iso2)), ''),
      'ZZ'
    ) AS country_iso2
  FROM payment_withdrawals w
  JOIN LATERAL (
    SELECT le2.*
    FROM ledger_entries le2
    WHERE le2.user_id = w.user_id
      AND le2.entry_type = 'withdrawal.pending.settled'
      AND le2.amount_minor < 0
      AND le2.metadata->>'provider_order_id' = w.provider_order_id
    ORDER BY le2.created_at ASC
    LIMIT 1
  ) le ON true
  LEFT JOIN LATERAL (
    SELECT ts.country_iso2
    FROM traffic_sessions ts
    WHERE ts.user_id = le.user_id
      AND ts.last_at <= le.created_at
    ORDER BY ts.last_at DESC
    LIMIT 1
  ) tr ON true
  WHERE w.provider = 'passimpay'
    AND w.status IN ('COMPLETED','PAID')
    AND w.updated_at >= $1 AND w.updated_at < $2
),
lined AS (
  SELECT * FROM deposit_lines
  UNION ALL
  SELECT * FROM withdrawal_lines
)
SELECT
  COUNT(*)::bigint,
  COUNT(*) FILTER (WHERE src = 'fingerprint_ledger')::bigint,
  COUNT(*) FILTER (WHERE src = 'traffic_session')::bigint,
  COUNT(*) FILTER (WHERE src = 'ledger_explicit')::bigint,
  COUNT(*) FILTER (WHERE src = 'unknown')::bigint,
  COUNT(*) FILTER (WHERE country_iso2 = 'ZZ')::bigint
FROM lined
`

	var cov FinanceGeoCoverage
	err = pool.QueryRow(ctx, covSQL, start, end).Scan(
		&cov.TotalLines,
		&cov.FingerprintLedgerLines,
		&cov.TrafficSessionLines,
		&cov.LedgerExplicitLines,
		&cov.UnknownSourceLines,
		&cov.UnknownCountryLines,
	)
	if err != nil {
		return FinanceGeoPayload{}, err
	}
	if cov.TotalLines > 0 {
		cov.CountryResolvedPct = math.Round((float64(cov.TotalLines-cov.UnknownCountryLines)/float64(cov.TotalLines))*1000) / 10
	}

	sort.Slice(out, func(i, j int) bool {
		vi := out[i].DepositsMinor + out[i].WithdrawalsMinor
		vj := out[j].DepositsMinor + out[j].WithdrawalsMinor
		if vi != vj {
			return vi > vj
		}
		return out[i].ISO2 < out[j].ISO2
	})

	notes := "Ledger lines joined with Fingerprint geo on metadata (withdrawals), optional attribution keys, then latest traffic_sessions at or before each line. " +
		"Deposit webhooks usually lack browser IP — traffic_session attributes country from lobby analytics. " +
		"Volumes are per currency (minor units); compare same currency only."

	return FinanceGeoPayload{
		Period:   label,
		Notes:    notes,
		Rows:     out,
		Coverage: cov,
	}, nil
}

// FinanceGeoAnalytics is GET /v1/admin/analytics/finance-geo — financial volume by resolved country.
func (h *Handler) FinanceGeoAnalytics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	start, end, label, err := parseTrafficWindow(r.URL.Query().Get("period"), r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_period", "use period=7d,30d,90d,6m,ytd,all or start/end")
		return
	}
	if h.dashboardDisplaySuppressed(r.Context()) {
		_ = json.NewEncoder(w).Encode(zeroFinanceGeoPayload(label))
		return
	}
	payload, err := buildFinanceGeoFromDB(r.Context(), h.Pool, start, end, label)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "finance geo query failed")
		return
	}
	_ = json.NewEncoder(w).Encode(payload)
}
