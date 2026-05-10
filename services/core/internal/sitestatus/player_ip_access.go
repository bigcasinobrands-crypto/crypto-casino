package sitestatus

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Site settings keys edited from Admin → Settings → Security (IP lists).
const (
	SettingKeyIPBlacklist = "security.ip_blacklist"
	SettingKeyIPWhitelist = "security.ip_whitelist"
)

type ipListsSnapshot struct {
	at        time.Time
	whitelist []*net.IPNet
	blacklist []*net.IPNet
}

var (
	ipListsMu     sync.RWMutex
	ipListsCached ipListsSnapshot
	ipListsTTL    = 5 * time.Second
	ipListsNegTTL = 2 * time.Second // empty / missing rows
)

// InvalidatePlayerIPAccessCache clears cached IP lists so PATCH settings take effect immediately.
func InvalidatePlayerIPAccessCache() {
	ipListsMu.Lock()
	ipListsCached = ipListsSnapshot{}
	ipListsMu.Unlock()
}

// PlayerClientIP returns the client IP best-effort (chi RealIP middleware sets RemoteAddr).
func PlayerClientIP(r *http.Request) net.IP {
	if r == nil {
		return nil
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	return net.ParseIP(host)
}

// PlayerIPBlocked reports whether the caller should be denied based on security.ip_whitelist / ip_blacklist.
// Whitelist mode: if any whitelist entries are configured, only matching IPs are allowed (unless also blacklisted).
// Otherwise only blacklist matches deny.
func PlayerIPBlocked(ctx context.Context, pool *pgxpool.Pool, r *http.Request) (blocked bool, err error) {
	wl, bl, err := ipListsSnapshotFor(ctx, pool)
	if err != nil {
		return false, err
	}
	ip := PlayerClientIP(r)
	if len(wl) > 0 {
		if ip == nil || !ipNetListContains(wl, ip) {
			return true, nil
		}
		if ipNetListContains(bl, ip) {
			return true, nil
		}
		return false, nil
	}
	if ip == nil {
		return false, nil
	}
	return ipNetListContains(bl, ip), nil
}

func ipListsSnapshotFor(ctx context.Context, pool *pgxpool.Pool) (whitelist, blacklist []*net.IPNet, err error) {
	ipListsMu.RLock()
	cached := ipListsCached
	ipListsMu.RUnlock()

	ttl := ipListsTTL
	if len(cached.whitelist) == 0 && len(cached.blacklist) == 0 && cached.at.After(time.Time{}) {
		ttl = ipListsNegTTL
	}
	if cached.at.After(time.Time{}) && time.Since(cached.at) < ttl {
		return cached.whitelist, cached.blacklist, nil
	}

	wLines, err := readIPSettingLines(ctx, pool, SettingKeyIPWhitelist)
	if err != nil {
		return nil, nil, err
	}
	bLines, err := readIPSettingLines(ctx, pool, SettingKeyIPBlacklist)
	if err != nil {
		return nil, nil, err
	}

	wl := netsFromLines(wLines)
	bl := netsFromLines(bLines)

	ipListsMu.Lock()
	ipListsCached = ipListsSnapshot{at: time.Now(), whitelist: wl, blacklist: bl}
	ipListsMu.Unlock()
	return wl, bl, nil
}

func readIPSettingLines(ctx context.Context, pool *pgxpool.Pool, key string) ([]string, error) {
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, key).Scan(&raw)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return parseIPLinesFromSetting(raw), nil
}

func parseIPLinesFromSetting(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var asStr string
	if json.Unmarshal(raw, &asStr) == nil && strings.TrimSpace(asStr) != "" {
		return splitIPLines(asStr)
	}
	var asArr []string
	if json.Unmarshal(raw, &asArr) == nil {
		return normalizeIPLineParts(asArr)
	}
	return splitIPLines(strings.TrimSpace(string(raw)))
}

func splitIPLines(s string) []string {
	lines := strings.Split(s, "\n")
	return normalizeIPLineParts(lines)
}

func normalizeIPLineParts(parts []string) []string {
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" || strings.HasPrefix(p, "#") {
			continue
		}
		out = append(out, p)
	}
	return out
}

func netsFromLines(lines []string) []*net.IPNet {
	var out []*net.IPNet
	for _, ln := range lines {
		if n, ok := parseIPCIDRLine(ln); ok {
			out = append(out, n)
		}
	}
	return out
}

func parseIPCIDRLine(line string) (*net.IPNet, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil, false
	}
	if strings.Contains(line, "/") {
		_, n, err := net.ParseCIDR(line)
		return n, err == nil
	}
	ip := net.ParseIP(line)
	if ip == nil {
		return nil, false
	}
	if v4 := ip.To4(); v4 != nil {
		return &net.IPNet{IP: v4, Mask: net.CIDRMask(32, 32)}, true
	}
	return &net.IPNet{IP: ip, Mask: net.CIDRMask(128, 128)}, true
}

func ipNetListContains(nets []*net.IPNet, ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, n := range nets {
		if n != nil && n.Contains(ip) {
			return true
		}
	}
	return false
}
