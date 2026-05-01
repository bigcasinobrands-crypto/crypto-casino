package adminops

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func parseTrafficWindow(period, startRaw, endRaw string) (start, end time.Time, label string, err error) {
	end = time.Now().UTC()
	if strings.TrimSpace(startRaw) != "" || strings.TrimSpace(endRaw) != "" {
		start, err = parseFlexibleTime(startRaw, true)
		if err != nil {
			return time.Time{}, time.Time{}, "", err
		}
		customEnd, err := parseFlexibleTime(endRaw, false)
		if err != nil {
			return time.Time{}, time.Time{}, "", err
		}
		if customEnd.IsZero() {
			customEnd = end
		}
		if start.IsZero() {
			start = customEnd.Add(-30 * 24 * time.Hour)
		}
		if customEnd.Before(start) {
			return time.Time{}, time.Time{}, "", fmt.Errorf("invalid range")
		}
		return start, customEnd, "custom", nil
	}

	switch strings.ToLower(strings.TrimSpace(period)) {
	case "", "30d":
		label = "30d"
		start = end.Add(-30 * 24 * time.Hour)
	case "7d":
		label = "7d"
		start = end.Add(-7 * 24 * time.Hour)
	case "90d":
		label = "90d"
		start = end.Add(-90 * 24 * time.Hour)
	case "6m":
		label = "6m"
		start = end.AddDate(0, -6, 0)
	case "ytd":
		label = "ytd"
		start = time.Date(end.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	case "all":
		label = "all"
		start = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	default:
		err = fmt.Errorf("unsupported period")
	}
	return start, end, label, err
}

func countryDisplayName(iso string) string {
	iso = strings.ToUpper(strings.TrimSpace(iso))
	if iso == "" || iso == "ZZ" {
		return "Unknown"
	}
	if n := countryNames[iso]; n != "" {
		return n
	}
	return iso
}

// subset of ISO 3166-1 alpha-2 for display
var countryNames = map[string]string{
	"US": "United States", "GB": "United Kingdom", "DE": "Germany", "CA": "Canada",
	"AU": "Australia", "BR": "Brazil", "FR": "France", "IN": "India", "NL": "Netherlands",
	"SE": "Sweden", "ES": "Spain", "IT": "Italy", "MX": "Mexico", "JP": "Japan",
	"KR": "South Korea", "PL": "Poland", "PT": "Portugal", "IE": "Ireland", "NZ": "New Zealand",
	"NO": "Norway", "FI": "Finland", "DK": "Denmark", "CH": "Switzerland", "AT": "Austria",
	"BE": "Belgium", "CZ": "Czechia", "GR": "Greece", "HU": "Hungary", "RO": "Romania",
	"AR": "Argentina", "CL": "Chile", "CO": "Colombia", "ZA": "South Africa", "EG": "Egypt",
	"AE": "United Arab Emirates", "SA": "Saudi Arabia", "SG": "Singapore", "MY": "Malaysia",
	"TH": "Thailand", "VN": "Vietnam", "PH": "Philippines", "ID": "Indonesia", "TR": "Turkey",
	"RU": "Russia", "UA": "Ukraine",
}

func acquisitionChannel(referrerHost, utmSource, utmMedium string) string {
	h := strings.ToLower(referrerHost)
	us := strings.ToLower(strings.TrimSpace(utmSource))
	um := strings.ToLower(strings.TrimSpace(utmMedium))

	if um == "email" || um == "newsletter" || um == "crm" || us == "newsletter" {
		return "Email & CRM"
	}
	if um == "cpc" || um == "ppc" || um == "paid_search" || um == "paid" || um == "paid_social" {
		if strings.Contains(h, "facebook") || strings.Contains(h, "instagram") || us == "facebook" || us == "instagram" || us == "tiktok" {
			return "Social"
		}
		return "Paid search"
	}
	if um == "display" || um == "banner" || um == "programmatic" {
		return "Display / programmatic"
	}
	if us == "facebook" || us == "instagram" || us == "twitter" || us == "tiktok" || us == "reddit" {
		return "Social"
	}
	if strings.Contains(h, "facebook.") || strings.Contains(h, "instagram.") || strings.Contains(h, "t.co") ||
		strings.Contains(h, "reddit.") || strings.Contains(h, "tiktok.") || strings.Contains(h, "linkedin.") {
		return "Social"
	}
	if h == "" {
		return "Direct / bookmark"
	}
	if strings.Contains(h, "google.") || strings.Contains(h, "bing.") || strings.Contains(h, "duckduckgo.") || strings.Contains(h, "yahoo.") {
		return "Organic search"
	}
	if strings.Contains(h, "doubleclick") || strings.Contains(h, "googlesyndication") {
		return "Display / programmatic"
	}
	return "Affiliate / partner"
}

func referrerCategory(host string) string {
	h := strings.ToLower(host)
	if h == "" {
		return "direct_proxy"
	}
	if strings.Contains(h, "google.") || strings.Contains(h, "bing.") || strings.Contains(h, "duckduckgo.") || strings.Contains(h, "yahoo.") {
		return "search"
	}
	if strings.Contains(h, "facebook.") || strings.Contains(h, "instagram.") || h == "t.co" ||
		strings.Contains(h, "reddit.") || strings.Contains(h, "tiktok.") || strings.Contains(h, "youtube.") {
		return "social"
	}
	if strings.Contains(h, "news.") || strings.Contains(h, "blog") {
		return "content"
	}
	return "affiliate"
}

func socialPlatformFromHost(host string) (name string, ok bool) {
	h := strings.ToLower(host)
	switch {
	case strings.Contains(h, "twitter") || h == "t.co":
		return "X (Twitter)", true
	case strings.Contains(h, "instagram"):
		return "Instagram", true
	case strings.Contains(h, "facebook"):
		return "Facebook", true
	case strings.Contains(h, "reddit"):
		return "Reddit", true
	case strings.Contains(h, "youtube") || strings.Contains(h, "youtu.be"):
		return "YouTube", true
	case strings.Contains(h, "tiktok"):
		return "TikTok", true
	case strings.Contains(h, "t.me") || strings.Contains(h, "telegram"):
		return "Telegram", true
	case strings.Contains(h, "linkedin"):
		return "LinkedIn", true
	default:
		return "", false
	}
}

func buildTrafficAnalyticsFromDB(ctx context.Context, pool *pgxpool.Pool, start, end time.Time, periodLabel string) (TrafficAnalyticsPayload, error) {
	out := TrafficAnalyticsPayload{
		Period:          periodLabel,
		Countries:       []TrafficCountryRow{},
		Channels:        []TrafficChannelRow{},
		SocialPlatforms: []SocialPlatformRow{},
		Referrers:       []ReferrerRow{},
		UTMCampaigns:    []UTMCampaignRow{},
		LandingPages:    []LandingPageRow{},
		Notes:           "Figures are derived from player-site sessions recorded via POST /v1/analytics/session.",
	}

	var sessionsTotal int64
	var anonSessions int64
	var avgSec *float64
	err := pool.QueryRow(ctx, `
SELECT
  COUNT(*)::bigint,
  COUNT(*) FILTER (WHERE user_id IS NULL)::bigint,
  AVG(GREATEST(EXTRACT(EPOCH FROM (last_at - started_at)), 0))::float8
FROM traffic_sessions
WHERE started_at >= $1 AND started_at < $2
`, start, end).Scan(&sessionsTotal, &anonSessions, &avgSec)
	if err != nil {
		return out, err
	}
	out.SessionsTotal = sessionsTotal
	out.UniqueVisitors = sessionsTotal
	if sessionsTotal > 0 {
		out.NewVisitorsPct = 100 * float64(anonSessions) / float64(sessionsTotal)
	}
	if avgSec != nil && !math.IsNaN(*avgSec) {
		out.AvgSessionSec = *avgSec
	}

	// registrations by country (users created in window; country from earliest session)
	regByISO := map[string]int64{}
	regRows, err := pool.Query(ctx, `
WITH nu AS (
  SELECT id FROM users WHERE created_at >= $1 AND created_at < $2
),
fs AS (
  SELECT DISTINCT ON (ts.user_id)
    ts.user_id,
    COALESCE(NULLIF(UPPER(TRIM(ts.country_iso2)), ''), 'ZZ') AS iso
  FROM traffic_sessions ts
  INNER JOIN nu ON nu.id = ts.user_id
  ORDER BY ts.user_id, ts.started_at ASC
)
SELECT iso, COUNT(*)::bigint FROM fs GROUP BY 1
`, start, end)
	if err != nil {
		return out, err
	}
	defer regRows.Close()
	for regRows.Next() {
		var iso string
		var c int64
		if err := regRows.Scan(&iso, &c); err != nil {
			return out, err
		}
		regByISO[iso] = c
	}
	if err := regRows.Err(); err != nil {
		return out, err
	}

	rows, err := pool.Query(ctx, `
SELECT
  COALESCE(NULLIF(UPPER(TRIM(country_iso2)), ''), 'ZZ') AS iso,
  referrer_host,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  device_type,
  landing_path,
  page_views
FROM traffic_sessions
WHERE started_at >= $1 AND started_at < $2
`, start, end)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	type utmSig struct {
		us, um, uc, uco, ut string
	}
	channelCounts := map[string]int64{}
	socialCounts := map[string]int64{}
	socialTopHost := map[string]string{}
	refCounts := map[string]int64{}
	refLanding := map[string]string{}
	utmCounts := map[utmSig]int64{}
	landingBounce := map[string]struct {
		total, bounce int64
	}{}
	tech := map[string]int64{}
	countryCounts := map[string]int64{}

	for rows.Next() {
		var iso, refHost, us, um, uc, uco, ut string
		var dev, land string
		var pv int64
		if err := rows.Scan(&iso, &refHost, &us, &um, &uc, &uco, &ut, &dev, &land, &pv); err != nil {
			return out, err
		}
		const w = int64(1)
		countryCounts[iso] += w
		ch := acquisitionChannel(refHost, us, um)
		channelCounts[ch] += w
		if plat, ok := socialPlatformFromHost(refHost); ok {
			socialCounts[plat] += w
			if socialTopHost[plat] == "" && refHost != "" {
				socialTopHost[plat] = refHost
			}
		}
		rh := strings.ToLower(refHost)
		if rh != "" {
			refCounts[rh] += w
			if refLanding[rh] == "" && land != "" {
				refLanding[rh] = land
			}
		}
		if strings.TrimSpace(us) != "" || strings.TrimSpace(um) != "" || strings.TrimSpace(uc) != "" ||
			strings.TrimSpace(uco) != "" || strings.TrimSpace(ut) != "" {
			key := utmSig{us, um, uc, uco, ut}
			utmCounts[key] += w
		}
		if land != "" {
			lb := landingBounce[land]
			lb.total += w
			if pv <= 1 {
				lb.bounce += w
			}
			landingBounce[land] = lb
		}
		if dev != "" {
			tech[dev] += w
		}
	}
	if err := rows.Err(); err != nil {
		return out, err
	}

	totalF := float64(sessionsTotal)
	if totalF <= 0 {
		out.Notes = "No sessions in this period yet. Traffic is recorded when players browse the lobby (see POST /v1/analytics/session)."
		return out, nil
	}

	// countries
	type ckv struct {
		iso string
		n   int64
	}
	var cList []ckv
	for iso, n := range countryCounts {
		cList = append(cList, ckv{iso, n})
	}
	sort.Slice(cList, func(i, j int) bool { return cList[i].n > cList[j].n })
	for _, e := range cList {
		if len(out.Countries) >= 40 {
			break
		}
		out.Countries = append(out.Countries, TrafficCountryRow{
			ISO2:          e.iso,
			Name:          countryDisplayName(e.iso),
			Sessions:      e.n,
			PctOfTotal:    100 * float64(e.n) / totalF,
			Registrations: regByISO[e.iso],
		})
	}

	// channels
	var chKeys []string
	for k := range channelCounts {
		chKeys = append(chKeys, k)
	}
	sort.Slice(chKeys, func(i, j int) bool { return channelCounts[chKeys[i]] > channelCounts[chKeys[j]] })
	for _, k := range chKeys {
		n := channelCounts[k]
		out.Channels = append(out.Channels, TrafficChannelRow{
			Channel:    k,
			Sessions:   n,
			PctOfTotal: 100 * float64(n) / totalF,
			ConvRate:   0,
		})
	}

	// social
	var spKeys []string
	for k := range socialCounts {
		spKeys = append(spKeys, k)
	}
	sort.Slice(spKeys, func(i, j int) bool { return socialCounts[spKeys[i]] > socialCounts[spKeys[j]] })
	for _, k := range spKeys {
		n := socialCounts[k]
		out.SocialPlatforms = append(out.SocialPlatforms, SocialPlatformRow{
			Platform:   k,
			Sessions:   n,
			PctOfTotal: 100 * float64(n) / totalF,
			TopRefHost: socialTopHost[k],
		})
	}

	// referrers
	var rKeys []string
	for k := range refCounts {
		rKeys = append(rKeys, k)
	}
	sort.Slice(rKeys, func(i, j int) bool { return refCounts[rKeys[i]] > refCounts[rKeys[j]] })
	for _, k := range rKeys {
		if len(out.Referrers) >= 30 {
			break
		}
		n := refCounts[k]
		out.Referrers = append(out.Referrers, ReferrerRow{
			Host:        k,
			Category:    referrerCategory(k),
			Sessions:    n,
			PctOfTotal:  100 * float64(n) / totalF,
			LandingPath: refLanding[k],
		})
	}

	type utmE struct {
		k        utmSig
		sessions int64
	}
	var utmList []utmE
	for s, n := range utmCounts {
		utmList = append(utmList, utmE{s, n})
	}
	sort.Slice(utmList, func(i, j int) bool { return utmList[i].sessions > utmList[j].sessions })
	for _, e := range utmList {
		if len(out.UTMCampaigns) >= 25 {
			break
		}
		out.UTMCampaigns = append(out.UTMCampaigns, UTMCampaignRow{
			Source:   e.k.us,
			Medium:   e.k.um,
			Campaign: e.k.uc,
			Content:  strings.TrimSpace(e.k.uco),
			Term:     strings.TrimSpace(e.k.ut),
			Sessions: e.sessions,
		})
	}

	// landing pages
	type lpv struct {
		path string
		t, b int64
	}
	var lpList []lpv
	for p, v := range landingBounce {
		lpList = append(lpList, lpv{p, v.total, v.bounce})
	}
	sort.Slice(lpList, func(i, j int) bool { return lpList[i].t > lpList[j].t })
	for _, e := range lpList {
		if len(out.LandingPages) >= 20 {
			break
		}
		bPct := 0.0
		if e.t > 0 {
			bPct = 100 * float64(e.b) / float64(e.t)
		}
		out.LandingPages = append(out.LandingPages, LandingPageRow{
			Path:      e.path,
			Sessions:  e.t,
			BouncePct: bPct,
		})
	}

	tSum := float64(0)
	for _, n := range tech {
		tSum += float64(n)
	}
	if tSum > 0 {
		out.Technology = TrafficTechnology{
			MobilePct:  100 * float64(tech["mobile"]) / tSum,
			DesktopPct: 100 * float64(tech["desktop"]) / tSum,
			TabletPct:  100 * float64(tech["tablet"]) / tSum,
		}
	}

	return out, nil
}
