package fingerprint

import (
	"strings"
	"time"
)

// LedgerMetaFromEvent maps a Get Event JSON body into compact ledger metadata keys (audit snapshot).
// Values follow the integration spec: visitorId, fingerprintRequestId, geo*, ip, etc.
func LedgerMetaFromEvent(root map[string]any) map[string]any {
	if root == nil {
		return nil
	}
	out := make(map[string]any)
	data := identificationData(root)
	if data == nil {
		return out
	}

	putStr := func(key, val string) {
		val = strings.TrimSpace(val)
		if val != "" {
			out[key] = val
		}
	}

	if v, ok := data["visitorId"].(string); ok {
		putStr("visitor_id", v)
	}
	if v, ok := data["requestId"].(string); ok {
		putStr("fingerprint_request_id", v)
	}
	if v, ok := data["linkedId"].(string); ok {
		putStr("linked_id", v)
	}
	if v, ok := data["ip"].(string); ok {
		putStr("ip_address", v)
	}
	if loc, ok := data["ipLocation"].(map[string]any); ok && loc != nil {
		if v, ok := loc["country"].(map[string]any); ok {
			if code, ok := v["code"].(string); ok {
				putStr("geo_country", code)
			}
		} else if cs, ok := loc["country"].(string); ok && len(strings.TrimSpace(cs)) >= 2 {
			// Some API shapes expose ISO2 directly on country.
			putStr("geo_country", cs)
		}
		putStr("geo_region", strFromAny(loc["region"]))
		putStr("geo_city", strFromAny(loc["city"]))
	}
	if v, ok := data["confidence"].(map[string]any); ok && v != nil {
		if score, ok := v["score"].(float64); ok {
			out["fp_confidence_score"] = score
		}
	}
	if v, ok := data["replayed"].(bool); ok {
		out["fp_replayed"] = v
	}
	if v, ok := data["incognito"].(bool); ok {
		out["fp_incognito"] = v
	}
	out["fp_context_captured_at"] = time.Now().UTC().Format(time.RFC3339)
	out["fingerprint_provider"] = "fingerprint.com"
	return out
}

func identificationData(root map[string]any) map[string]any {
	if root == nil {
		return nil
	}
	prod, _ := root["products"].(map[string]any)
	if prod == nil {
		return nil
	}
	idn, _ := prod["identification"].(map[string]any)
	if idn == nil {
		return nil
	}
	data, _ := idn["data"].(map[string]any)
	return data
}

func strFromAny(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return ""
	}
}
