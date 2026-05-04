package reconcile

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func str(m map[string]any, k string) string {
	if m == nil {
		return ""
	}
	v, ok := m[k]
	if !ok || v == nil {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

// MaybeInsertGeoTrafficMismatch records when Fingerprint geo on the ledger line disagrees with
// traffic-based attribution (lobby session before the event).
func MaybeInsertGeoTrafficMismatch(ctx context.Context, pool *pgxpool.Pool, userID, referenceType, referenceID string, meta map[string]any) error {
	if pool == nil || meta == nil {
		return nil
	}
	fpCC := strings.ToUpper(str(meta, "geo_country"))
	trCC := strings.ToUpper(str(meta, "attribution_country_iso2"))
	if fpCC == "" || trCC == "" || fpCC == trCC {
		return nil
	}
	if fpCC == "ZZ" || trCC == "ZZ" {
		return nil
	}
	details := map[string]any{
		"geo_country_fp":              fpCC,
		"attribution_country_traffic": trCC,
	}
	b, _ := json.Marshal(details)
	var uid any
	if u := strings.TrimSpace(userID); u != "" {
		uid = u
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
		VALUES ('geo_fp_vs_traffic', $1::uuid, $2, $3, $4::jsonb)
	`, uid, strings.TrimSpace(referenceType), strings.TrimSpace(referenceID), b)
	return err
}
