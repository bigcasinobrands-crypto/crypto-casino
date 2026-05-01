package games

import (
	"strings"
)

// StudioSearchPatterns returns DISTINCT ILIKE patterns for q (always includes "%"+q+"%").
// Catalog feeds often store studio codes (pp, bs, ga) while players search by brand name — add alias patterns.
func StudioSearchPatterns(q string) []string {
	q = strings.TrimSpace(q)
	if q == "" {
		return nil
	}
	base := "%" + q + "%"
	seen := map[string]struct{}{base: {}}
	out := []string{base}
	add := func(p string) {
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}

	low := strings.ToLower(q)

	switch {
	case low == "pp":
		add("%pragmatic%")
		add("%pragmaticplay%")
		add("%pragmatic play%")
	case strings.Contains(low, "pragmatic"):
		add("%pp%")
		add("%pragmaticplay%")
		add("%pragmatic play%")
		add("%pragmatic_external%")
	case low == "bs":
		add("%betsoft%")
		add("%bsg%")
	case strings.Contains(low, "betsoft"):
		add("%bs%")
		add("%bsg%")
	case low == "ga":
		add("%gameart%")
	case strings.Contains(low, "gameart"):
		add("%ga%")
	case strings.Contains(low, "pgsoft") || strings.Contains(low, "pg soft"):
		add("%pg_soft%")
		add("%pgsoft%")
	}

	return out
}
