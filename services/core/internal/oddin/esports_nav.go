package oddin

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playerapi"
)

const (
	// Oddin iframe “Sports order” can expose many disciplines; allow full operator lists in ODDIN_ESPORTS_NAV_JSON.
	esportsNavMaxItems    = 80
	esportsNavMaxIDLen    = 64
	esportsNavMaxLabelLen = 128
	esportsNavMaxPageLen  = 512
	esportsNavMaxURILen   = 2048
)

var esportsNavIDRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

// EsportsNavItem is returned to the player SPA for the E-Sports sidebar (logos from operator / Oddin asset guidelines).
type EsportsNavItem struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Page    string `json:"page"`
	LogoURL string `json:"logoUrl,omitempty"`
}

// ParseEsportsNavJSON validates and normalizes ODDIN_ESPORTS_NAV_JSON (JSON array of objects).
func ParseEsportsNavJSON(raw string) ([]EsportsNavItem, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var in []map[string]any
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		return nil, err
	}
	if len(in) > esportsNavMaxItems {
		in = in[:esportsNavMaxItems]
	}
	out := make([]EsportsNavItem, 0, len(in))
	for _, m := range in {
		id := strings.TrimSpace(asString(m["id"]))
		if id == "" || len(id) > esportsNavMaxIDLen || !esportsNavIDRe.MatchString(id) {
			continue
		}
		label := strings.TrimSpace(asString(m["label"]))
		if label == "" || len(label) > esportsNavMaxLabelLen {
			continue
		}
		page := strings.TrimSpace(asString(m["page"]))
		if len(page) > esportsNavMaxPageLen {
			page = page[:esportsNavMaxPageLen]
		}
		logo := strings.TrimSpace(asString(m["logoUrl"]))
		if logo == "" {
			logo = strings.TrimSpace(asString(m["logo_url"]))
		}
		if logo != "" {
			if len(logo) > esportsNavMaxURILen || !strings.HasPrefix(strings.ToLower(logo), "https://") {
				logo = ""
			}
		}
		out = append(out, EsportsNavItem{
			ID:      id,
			Label:   label,
			Page:    page,
			LogoURL: logo,
		})
	}
	return out, nil
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

// EsportsNav serves GET /v1/sportsbook/oddin/esports-nav — public; items come from ODDIN_ESPORTS_NAV_JSON (Oddin-provided logo URLs).
func (h *Handler) EsportsNav(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.Cfg == nil || !h.Cfg.OddinIntegrationEnabled() {
		playerapi.WriteError(w, http.StatusNotFound, "oddin_disabled", "oddin integration is disabled")
		return
	}
	items, err := ParseEsportsNavJSON(h.Cfg.OddinEsportsNavJSON)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "esports_nav_invalid", "ODDIN_ESPORTS_NAV_JSON is not valid JSON")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"configured": len(strings.TrimSpace(h.Cfg.OddinEsportsNavJSON)) > 0 && len(items) > 0,
		"items":      items,
	})
}

// EsportsNavConfigured is true when non-empty JSON is set and parses to at least one item.
func EsportsNavConfigured(cfg *config.Config) bool {
	if cfg == nil {
		return false
	}
	items, err := ParseEsportsNavJSON(cfg.OddinEsportsNavJSON)
	return err == nil && len(items) > 0
}
