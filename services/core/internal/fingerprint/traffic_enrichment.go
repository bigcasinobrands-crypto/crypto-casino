package fingerprint

import "strings"

// TrafficEnrichment derives ISO2 country and coarse device class from a Server API event JSON body.
// Country prefers identification IP geolocation; device uses identification.browserDetails when present.
func TrafficEnrichment(root map[string]any) (countryISO2 string, deviceClass string) {
	if root == nil {
		return "", "unknown"
	}
	deviceClass = DeviceTypeFromEvent(root)
	m := LedgerMetaFromEvent(root)
	if s, ok := m["geo_country"].(string); ok {
		countryISO2 = NormalizeCountryISO2(s)
	}
	return countryISO2, deviceClass
}

// DeviceTypeFromEvent maps Fingerprint browserDetails.device to mobile|tablet|desktop|unknown.
func DeviceTypeFromEvent(root map[string]any) string {
	data := identificationData(root)
	if data == nil {
		return "unknown"
	}
	bd, _ := data["browserDetails"].(map[string]any)
	if bd == nil {
		return "unknown"
	}
	raw := strings.ToLower(strings.TrimSpace(stringField(bd["device"])))
	if raw == "" {
		return "unknown"
	}
	switch {
	case strings.Contains(raw, "tablet") || raw == "ipad":
		return "tablet"
	case strings.Contains(raw, "mobile") || strings.Contains(raw, "phone") || raw == "smartphone":
		return "mobile"
	default:
		// "desktop", "laptop", "other", etc.
		return "desktop"
	}
}

func stringField(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
