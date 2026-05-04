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

// identificationData returns a v3-shaped `identification.data` map.
// Server API v3 nests under products.identification.data; v4 flattens (event_id, identification, ip_info, browser_details).
func identificationData(root map[string]any) map[string]any {
	if root == nil {
		return nil
	}
	if data := v3IdentificationData(root); data != nil {
		return data
	}
	return v4IdentificationAsData(root)
}

func v3IdentificationData(root map[string]any) map[string]any {
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

// v4IdentificationAsData maps Server API v4 event JSON into the same keys LedgerMeta / TrafficEnrichment expect (camelCase data block).
func v4IdentificationAsData(root map[string]any) map[string]any {
	out := make(map[string]any)
	if ev, ok := root["event_id"].(string); ok && strings.TrimSpace(ev) != "" {
		out["requestId"] = strings.TrimSpace(ev)
	}
	idn, _ := root["identification"].(map[string]any)
	if idn != nil {
		if vid, ok := idn["visitor_id"].(string); ok && strings.TrimSpace(vid) != "" {
			out["visitorId"] = strings.TrimSpace(vid)
		}
		if conf, ok := idn["confidence"].(map[string]any); ok && conf != nil {
			out["confidence"] = conf
		}
	}
	if lid, ok := root["linked_id"].(string); ok && strings.TrimSpace(lid) != "" {
		out["linkedId"] = strings.TrimSpace(lid)
	}
	if ip, ok := root["ip_address"].(string); ok && strings.TrimSpace(ip) != "" {
		out["ip"] = strings.TrimSpace(ip)
	}
	if bd, ok := root["browser_details"].(map[string]any); ok && bd != nil {
		dev, _ := bd["device"].(string)
		out["browserDetails"] = map[string]any{"device": strings.TrimSpace(dev)}
	}
	if v, ok := root["replayed"].(bool); ok {
		out["replayed"] = v
	}
	if v, ok := root["incognito"].(bool); ok {
		out["incognito"] = v
	}
	if loc := v4IPLocationBlock(root); loc != nil {
		out["ipLocation"] = loc
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func v4IPLocationBlock(root map[string]any) map[string]any {
	ipinfo, _ := root["ip_info"].(map[string]any)
	if ipinfo == nil {
		return nil
	}
	for _, ver := range []string{"v4", "v6"} {
		block, ok := ipinfo[ver].(map[string]any)
		if !ok {
			continue
		}
		geo, _ := block["geolocation"].(map[string]any)
		if geo == nil {
			continue
		}
		cc, _ := geo["country_code"].(string)
		cc = strings.TrimSpace(cc)
		if cc == "" {
			continue
		}
		loc := map[string]any{
			"country": map[string]any{"code": cc},
			"city":    strFromAny(geo["city_name"]),
		}
		if regs, ok := geo["subdivisions"].([]any); ok && len(regs) > 0 {
			if rm, ok := regs[0].(map[string]any); ok {
				reg := strFromAny(rm["name"])
				if reg == "" {
					reg = strFromAny(rm["iso_code"])
				}
				loc["region"] = reg
			}
		}
		return loc
	}
	return nil
}

func strFromAny(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return ""
	}
}
