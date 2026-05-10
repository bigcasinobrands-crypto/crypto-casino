package sitestatus

import (
	"net/http"
	"strings"
)

// GeoCountryISO2FromRequest returns ISO 3166-1 alpha-2 when edge/CDN headers indicate country.
// Order: explicit proxy header (X-Geo-Country), Cloudflare (CF-IPCountry), CloudFront, Vercel.
func GeoCountryISO2FromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	candidates := []string{
		r.Header.Get("X-Geo-Country"),
		r.Header.Get("CF-IPCountry"),
		r.Header.Get("CloudFront-Viewer-Country"),
		r.Header.Get("X-Vercel-IP-Country"),
	}
	for _, raw := range candidates {
		cc := strings.TrimSpace(strings.ToUpper(raw))
		if geoISO2LooksValid(cc) {
			return cc
		}
	}
	return ""
}

func geoISO2LooksValid(cc string) bool {
	if len(cc) != 2 {
		return false
	}
	if cc == "XX" || cc == "ZZ" {
		return false
	}
	for i := 0; i < 2; i++ {
		c := cc[i]
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}
