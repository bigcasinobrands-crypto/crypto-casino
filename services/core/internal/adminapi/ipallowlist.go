package adminapi

import (
	"net"
	"net/http"
	"strings"
)

// IPAllowlistMiddleware returns 403 unless client IP matches one of the CIDRs or single IPs.
// Entries may be "192.168.1.0/24" or "203.0.113.10". Uses X-Forwarded-For first hop when present.
func IPAllowlistMiddleware(allow []string) func(http.Handler) http.Handler {
	parsed := make([]*net.IPNet, 0, len(allow))
	singles := make([]net.IP, 0, len(allow))
	for _, raw := range allow {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if strings.Contains(raw, "/") {
			_, n, err := net.ParseCIDR(raw)
			if err == nil {
				parsed = append(parsed, n)
			}
			continue
		}
		if ip := net.ParseIP(raw); ip != nil {
			singles = append(singles, ip)
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(parsed) == 0 && len(singles) == 0 {
				next.ServeHTTP(w, r)
				return
			}
			ip := clientIP(r)
			if !ipAllowed(ip, parsed, singles) {
				WriteError(w, http.StatusForbidden, "forbidden", "admin access not permitted from this IP")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) net.IP {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			if ip := net.ParseIP(strings.TrimSpace(parts[0])); ip != nil {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		if ip := net.ParseIP(host); ip != nil {
			return ip
		}
	}
	return net.ParseIP(r.RemoteAddr)
}

func ipAllowed(ip net.IP, nets []*net.IPNet, singles []net.IP) bool {
	if ip == nil {
		return false
	}
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	for _, s := range singles {
		if s.Equal(ip) {
			return true
		}
	}
	return false
}
