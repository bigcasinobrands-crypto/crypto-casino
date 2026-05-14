package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
)

// TrafficCountryRow is one row in the geo / map breakdown.
type TrafficCountryRow struct {
	ISO2          string  `json:"iso2"`
	Name          string  `json:"name"`
	Sessions      int64   `json:"sessions"`
	PctOfTotal    float64 `json:"pct_of_total"`
	Registrations int64   `json:"registrations"`
}

// TrafficChannelRow is high-level acquisition channel (organic, paid, social, etc.).
type TrafficChannelRow struct {
	Channel    string  `json:"channel"`
	Sessions   int64   `json:"sessions"`
	PctOfTotal float64 `json:"pct_of_total"`
	ConvRate   float64 `json:"conv_rate_pct"`
}

// SocialPlatformRow is traffic attributed to a social network.
type SocialPlatformRow struct {
	Platform   string  `json:"platform"`
	Sessions   int64   `json:"sessions"`
	PctOfTotal float64 `json:"pct_of_total"`
	TopRefHost string  `json:"top_ref_host,omitempty"`
}

// ReferrerRow is traffic by referring site / property.
type ReferrerRow struct {
	Host        string  `json:"host"`
	Category    string  `json:"category"` // search, social, affiliate, content, direct_proxy
	Sessions    int64   `json:"sessions"`
	PctOfTotal  float64 `json:"pct_of_total"`
	LandingPath string  `json:"top_landing_path,omitempty"`
}

// UTMCampaignRow groups UTM-tagged sessions.
type UTMCampaignRow struct {
	Source   string `json:"utm_source"`
	Medium   string `json:"utm_medium"`
	Campaign string `json:"utm_campaign"`
	Content  string `json:"utm_content,omitempty"`
	Term     string `json:"utm_term,omitempty"`
	Sessions int64  `json:"sessions"`
}

// LandingPageRow is top entry URLs.
type LandingPageRow struct {
	Path      string  `json:"path"`
	Sessions  int64   `json:"sessions"`
	BouncePct float64 `json:"bounce_pct"`
}

// TrafficTechnology summarizes device class.
type TrafficTechnology struct {
	MobilePct  float64 `json:"mobile_pct"`
	DesktopPct float64 `json:"desktop_pct"`
	TabletPct  float64 `json:"tablet_pct"`
}

// TrafficAnalyticsPayload is returned by GET /v1/admin/analytics/traffic.
// Populated with representative demo data until warehouse / pixel ingestion exists.
type TrafficAnalyticsPayload struct {
	Period          string              `json:"period"`
	SessionsTotal   int64               `json:"sessions_total"`
	UniqueVisitors  int64               `json:"unique_visitors"`
	NewVisitorsPct  float64             `json:"new_visitors_pct"`
	AvgSessionSec   float64             `json:"avg_session_seconds"`
	Countries       []TrafficCountryRow `json:"countries"`
	Channels        []TrafficChannelRow `json:"channels"`
	SocialPlatforms []SocialPlatformRow `json:"social_platforms"`
	Referrers       []ReferrerRow       `json:"referrers"`
	UTMCampaigns    []UTMCampaignRow    `json:"utm_campaigns"`
	LandingPages    []LandingPageRow    `json:"landing_pages"`
	Technology      TrafficTechnology   `json:"technology"`
	Notes           string              `json:"notes"`
}

func trafficAnalyticsDemo() TrafficAnalyticsPayload {
	return TrafficAnalyticsPayload{
		Period:         "30d",
		SessionsTotal:  128_400,
		UniqueVisitors: 84_200,
		NewVisitorsPct: 38.2,
		AvgSessionSec:  246.5,
		Countries: []TrafficCountryRow{
			{ISO2: "US", Name: "United States", Sessions: 42_100, PctOfTotal: 32.8, Registrations: 1820},
			{ISO2: "GB", Name: "United Kingdom", Sessions: 12_400, PctOfTotal: 9.7, Registrations: 510},
			{ISO2: "DE", Name: "Germany", Sessions: 9800, PctOfTotal: 7.6, Registrations: 402},
			{ISO2: "CA", Name: "Canada", Sessions: 8600, PctOfTotal: 6.7, Registrations: 360},
			{ISO2: "AU", Name: "Australia", Sessions: 6200, PctOfTotal: 4.8, Registrations: 265},
			{ISO2: "BR", Name: "Brazil", Sessions: 5100, PctOfTotal: 4.0, Registrations: 310},
			{ISO2: "FR", Name: "France", Sessions: 4800, PctOfTotal: 3.7, Registrations: 198},
			{ISO2: "IN", Name: "India", Sessions: 4200, PctOfTotal: 3.3, Registrations: 890},
			{ISO2: "NL", Name: "Netherlands", Sessions: 3100, PctOfTotal: 2.4, Registrations: 128},
			{ISO2: "SE", Name: "Sweden", Sessions: 2800, PctOfTotal: 2.2, Registrations: 95},
		},
		Channels: []TrafficChannelRow{
			{Channel: "Organic search", Sessions: 35_200, PctOfTotal: 27.4, ConvRate: 4.1},
			{Channel: "Direct / bookmark", Sessions: 28_100, PctOfTotal: 21.9, ConvRate: 6.8},
			{Channel: "Paid search", Sessions: 22_400, PctOfTotal: 17.4, ConvRate: 5.2},
			{Channel: "Affiliate / partner", Sessions: 18_600, PctOfTotal: 14.5, ConvRate: 7.1},
			{Channel: "Social", Sessions: 12_800, PctOfTotal: 10.0, ConvRate: 2.4},
			{Channel: "Email & CRM", Sessions: 6200, PctOfTotal: 4.8, ConvRate: 8.9},
			{Channel: "Display / programmatic", Sessions: 5100, PctOfTotal: 4.0, ConvRate: 1.1},
		},
		SocialPlatforms: []SocialPlatformRow{
			{Platform: "X (Twitter)", Sessions: 4200, PctOfTotal: 3.3, TopRefHost: "t.co"},
			{Platform: "Instagram", Sessions: 3100, PctOfTotal: 2.4, TopRefHost: "l.instagram.com"},
			{Platform: "Facebook", Sessions: 2800, PctOfTotal: 2.2, TopRefHost: "m.facebook.com"},
			{Platform: "Reddit", Sessions: 1400, PctOfTotal: 1.1, TopRefHost: "reddit.com"},
			{Platform: "YouTube", Sessions: 980, PctOfTotal: 0.8, TopRefHost: "youtube.com"},
			{Platform: "TikTok", Sessions: 620, PctOfTotal: 0.5, TopRefHost: "tiktok.com"},
			{Platform: "Telegram", Sessions: 410, PctOfTotal: 0.3, TopRefHost: "t.me"},
		},
		Referrers: []ReferrerRow{
			{Host: "google.com", Category: "search", Sessions: 31_200, PctOfTotal: 24.3, LandingPath: "/"},
			{Host: "bing.com", Category: "search", Sessions: 4200, PctOfTotal: 3.3, LandingPath: "/promotions"},
			{Host: "duckduckgo.com", Category: "search", Sessions: 1800, PctOfTotal: 1.4, LandingPath: "/"},
			{Host: "partner-casino.example", Category: "affiliate", Sessions: 12_400, PctOfTotal: 9.7, LandingPath: "/r/partner-casino"},
			{Host: "streamer-hub.gg", Category: "affiliate", Sessions: 6200, PctOfTotal: 4.8, LandingPath: "/r/stream"},
			{Host: "news.crypto.example", Category: "content", Sessions: 2800, PctOfTotal: 2.2, LandingPath: "/blog/welcome-bonus"},
			{Host: "t.co", Category: "social", Sessions: 4100, PctOfTotal: 3.2, LandingPath: "/"},
			{Host: "reddit.com", Category: "social", Sessions: 1400, PctOfTotal: 1.1, LandingPath: "/games"},
		},
		UTMCampaigns: []UTMCampaignRow{
			{Source: "newsletter", Medium: "email", Campaign: "mar_vip_reactivation", Content: "hero_cta", Sessions: 2400},
			{Source: "google", Medium: "cpc", Campaign: "brand_exact", Term: "twox casino", Sessions: 18_200},
			{Source: "facebook", Medium: "paid_social", Campaign: "lookalike_depositors", Sessions: 6200},
			{Source: "twitter", Medium: "social", Campaign: "launch_stream", Sessions: 1800},
			{Source: "affiliate", Medium: "cpa", Campaign: "q1_partner_push", Sessions: 9100},
		},
		LandingPages: []LandingPageRow{
			{Path: "/", Sessions: 45_200, BouncePct: 42.1},
			{Path: "/games", Sessions: 18_400, BouncePct: 28.4},
			{Path: "/promotions", Sessions: 12_100, BouncePct: 35.2},
			{Path: "/register", Sessions: 9800, BouncePct: 18.6},
			{Path: "/blog/welcome-bonus", Sessions: 4200, BouncePct: 55.0},
		},
		Technology: TrafficTechnology{
			MobilePct:  62.4,
			DesktopPct: 35.1,
			TabletPct:  2.5,
		},
		Notes: "Synthetic analytics snapshot for admin UI. Wire to warehouse / analytics export when available.",
	}
}

// TrafficAnalytics returns acquisition, geo, and referrer metrics from traffic_sessions.
// Query: period=7d|30d|90d|6m|ytd|all (default 30d) or custom start/end.
// Use ?source=demo for synthetic data (local UI only).
func (h *Handler) TrafficAnalytics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if strings.EqualFold(r.URL.Query().Get("source"), "demo") {
		_ = json.NewEncoder(w).Encode(trafficAnalyticsDemo())
		return
	}
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	start, end, label, err := parseTrafficWindow(r.URL.Query().Get("period"), r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_period", "use period=7d,30d,90d,6m,ytd,all or start/end")
		return
	}
	if h.dashboardDisplaySuppressed(r.Context()) {
		_ = json.NewEncoder(w).Encode(zeroTrafficAnalyticsPayload(label))
		return
	}
	payload, err := buildTrafficAnalyticsFromDB(r.Context(), h.Pool, start, end, label)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "analytics query failed")
		return
	}
	_ = json.NewEncoder(w).Encode(payload)
}
