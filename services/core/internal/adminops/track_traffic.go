package adminops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/google/uuid"
)

type trafficSessionIngest struct {
	SessionKey  string `json:"session_key"`
	Path        string `json:"path"`
	Referrer    string `json:"referrer,omitempty"`
	DeviceType  string `json:"device_type,omitempty"`
	UTMSource   string `json:"utm_source,omitempty"`
	UTMMedium   string `json:"utm_medium,omitempty"`
	UTMCampaign string `json:"utm_campaign,omitempty"`
	UTMContent  string `json:"utm_content,omitempty"`
	UTMTerm     string `json:"utm_term,omitempty"`
	// Fingerprint Pro (browser) — used with Server API to fill geo + device for admin Demographics.
	FingerprintRequestID string `json:"fingerprint_request_id,omitempty"`
	FingerprintVisitorID  string `json:"fingerprint_visitor_id,omitempty"`
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(strings.TrimSpace(s))
	if len(r) <= max {
		return string(r)
	}
	return string(r[:max])
}

func hostFromReferrer(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	u, err := url.Parse(ref)
	if err != nil || u.Host == "" {
		return ""
	}
	h := strings.ToLower(u.Hostname())
	return strings.TrimPrefix(h, "www.")
}

func normalizeDeviceType(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "mobile", "phone":
		return "mobile"
	case "tablet":
		return "tablet"
	case "desktop":
		return "desktop"
	default:
		return "unknown"
	}
}

func normalizeISO2(s string) string {
	s = strings.TrimSpace(strings.ToUpper(s))
	if len(s) != 2 {
		return ""
	}
	if s[0] < 'A' || s[0] > 'Z' || s[1] < 'A' || s[1] > 'Z' {
		return ""
	}
	return s
}

// IngestTrafficSession records or updates a browser session (public player API).
// Optional Bearer token ties the row to a user_id. Country: X-Geo-Country (edge) when set, else
// Fingerprint Server API from fingerprint_request_id when FINGERPRINT_SECRET_API_KEY is configured.
func (h *Handler) IngestTrafficSession(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		playerapi.WriteError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	var body trafficSessionIngest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14)).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "expected JSON body")
		return
	}
	sk := truncateRunes(body.SessionKey, 80)
	if sk == "" {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_session", "session_key required")
		return
	}
	path := truncateRunes(body.Path, 1024)
	if path == "" {
		path = "/"
	}
	refHost := hostFromReferrer(body.Referrer)
	devIn := normalizeDeviceType(body.DeviceType)
	ccHeader := normalizeISO2(r.Header.Get("X-Geo-Country"))

	fpRid := truncateRunes(body.FingerprintRequestID, 128)
	fpVid := truncateRunes(body.FingerprintVisitorID, 128)

	var userID *uuid.UUID
	if s, ok := playerapi.UserIDFromContext(r.Context()); ok {
		if u, err := uuid.Parse(s); err == nil {
			userID = &u
		}
	}

	utmS := truncateRunes(body.UTMSource, 256)
	utmM := truncateRunes(body.UTMMedium, 256)
	utmC := truncateRunes(body.UTMCampaign, 256)
	utmCo := truncateRunes(body.UTMContent, 256)
	utmT := truncateRunes(body.UTMTerm, 256)

	ctx := r.Context()
	finalCC := ccHeader
	geoSrc := ""
	fpCountry, fpDev := h.enrichFromFingerprint(ctx, fpRid)
	if finalCC == "" && fpCountry != "" {
		finalCC = fpCountry
		geoSrc = "fingerprint"
	} else if finalCC != "" {
		geoSrc = "edge"
	}
	finalDev := devIn
	if fpDev != "unknown" {
		finalDev = fpDev
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "tx begin failed")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertSQL = `
INSERT INTO traffic_sessions (
  session_key, user_id, country_iso2, device_type, referrer_host,
  landing_path, last_path, utm_source, utm_medium, utm_campaign, utm_content, utm_term, page_views,
  fingerprint_visitor_id, fingerprint_request_id, geo_source
) VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12,1,
  NULLIF($13,''), NULLIF($14,''), NULLIF($15,''))
ON CONFLICT (session_key) DO UPDATE SET
  last_at = now(),
  last_path = EXCLUDED.last_path,
  page_views = traffic_sessions.page_views + 1,
  user_id = COALESCE(EXCLUDED.user_id, traffic_sessions.user_id),
  country_iso2 = COALESCE(NULLIF(EXCLUDED.country_iso2,''), traffic_sessions.country_iso2),
  device_type = CASE
    WHEN NULLIF(EXCLUDED.device_type,'') IS NOT NULL AND EXCLUDED.device_type <> 'unknown' THEN EXCLUDED.device_type
    ELSE traffic_sessions.device_type
  END,
  fingerprint_visitor_id = COALESCE(NULLIF(traffic_sessions.fingerprint_visitor_id,''), NULLIF(EXCLUDED.fingerprint_visitor_id,'')),
  fingerprint_request_id = COALESCE(NULLIF(EXCLUDED.fingerprint_request_id,''), traffic_sessions.fingerprint_request_id),
  geo_source = COALESCE(NULLIF(EXCLUDED.geo_source,''), traffic_sessions.geo_source)
`

	_, err = tx.Exec(ctx, insertSQL,
		sk, userID, finalCC, finalDev, refHost,
		path, path,
		utmS, utmM, utmC, utmCo, utmT,
		fpVid, fpRid, geoSrc,
	)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "upsert failed")
		return
	}

	// First touch: keep landing_path / referrer / utm from the initial insert only.
	const patchFirstTouch = `
UPDATE traffic_sessions SET
  landing_path = COALESCE(NULLIF(landing_path,''), $2),
  referrer_host = COALESCE(NULLIF(referrer_host,''), $3),
  utm_source = CASE WHEN utm_source = '' AND $4 <> '' THEN $4 ELSE utm_source END,
  utm_medium = CASE WHEN utm_medium = '' AND $5 <> '' THEN $5 ELSE utm_medium END,
  utm_campaign = CASE WHEN utm_campaign = '' AND $6 <> '' THEN $6 ELSE utm_campaign END,
  utm_content = CASE WHEN utm_content = '' AND $7 <> '' THEN $7 ELSE utm_content END,
  utm_term = CASE WHEN utm_term = '' AND $8 <> '' THEN $8 ELSE utm_term END
WHERE session_key = $1
`
	_, err = tx.Exec(ctx, patchFirstTouch, sk, path, refHost, utmS, utmM, utmC, utmCo, utmT)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "update failed")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "commit failed")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "ts": time.Now().UTC().Format(time.RFC3339)})
}

func (h *Handler) enrichFromFingerprint(ctx context.Context, requestID string) (countryISO2, deviceType string) {
	deviceType = "unknown"
	if h == nil || h.Fingerprint == nil || h.Cfg == nil || !h.Cfg.FingerprintConfigured() {
		return "", deviceType
	}
	rid := strings.TrimSpace(requestID)
	if rid == "" {
		return "", deviceType
	}
	ev, err := h.Fingerprint.GetEvent(ctx, rid)
	if err != nil || ev == nil {
		return "", deviceType
	}
	return fingerprint.TrafficEnrichment(ev)
}
