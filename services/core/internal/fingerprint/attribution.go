package fingerprint

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// MergeTrafficAttributionTx adds lobby traffic-based attribution fields when not already set.
// Does not override geo_country / keys written by LedgerMetaFromEvent (Fingerprint on ledger).
// Sets: attribution_country_iso2, attribution_fingerprint_visitor_id, attribution_traffic_geo_source.
func MergeTrafficAttributionTx(ctx context.Context, tx pgx.Tx, userID string, at time.Time, meta map[string]any) error {
	if meta == nil || tx == nil {
		return nil
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	var ctry, fvid, gsrc string
	err := tx.QueryRow(ctx, `
		SELECT
			COALESCE(NULLIF(upper(trim(country_iso2)), ''), ''),
			COALESCE(NULLIF(trim(fingerprint_visitor_id), ''), ''),
			COALESCE(NULLIF(trim(geo_source), ''), '')
		FROM traffic_sessions
		WHERE user_id = $1::uuid AND last_at <= $2
		ORDER BY last_at DESC
		LIMIT 1
	`, userID, at.UTC()).Scan(&ctry, &fvid, &gsrc)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}
	if ctry != "" {
		if _, ok := meta["attribution_country_iso2"]; !ok {
			meta["attribution_country_iso2"] = ctry
		}
	}
	if fvid != "" {
		if _, ok := meta["attribution_fingerprint_visitor_id"]; !ok {
			meta["attribution_fingerprint_visitor_id"] = fvid
		}
	}
	if ctry != "" || fvid != "" {
		meta["attribution_traffic_geo_source"] = gsrc
	}
	return nil
}
