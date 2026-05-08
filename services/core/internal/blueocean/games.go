package blueocean

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// CatalogGame is a normalized row from getGameList.
type CatalogGame struct {
	BogID                 int64
	IDHash                string
	Name                  string
	GameType              string
	Subcategory           string
	ProviderSystem        string
	IsNew                 bool
	Mobile                bool
	HasJackpot            bool
	FeatureBuySupported   bool
	PlayForFunSupported   bool
	ThumbnailURL          string
	Raw                   map[string]any
}

func numToInt64(v any) (int64, bool) {
	switch t := v.(type) {
	case float64:
		return int64(t), true
	case json.Number:
		i, err := t.Int64()
		return i, err == nil
	case int64:
		return t, true
	case int:
		return int64(t), true
	default:
		return 0, false
	}
}

func strVal(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return string(t)
	case float64:
		return fmt.Sprintf("%.0f", t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

func boolVal(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t == "1" || t == "true" || t == "True"
	default:
		return false
	}
}

func bogIDFromMap(m map[string]any) int64 {
	for _, key := range []string{"id", "gameid", "game_id", "gameId"} {
		v, ok := m[key]
		if !ok {
			continue
		}
		if n, ok := numToInt64(v); ok && n != 0 {
			return n
		}
		s := strings.TrimSpace(strVal(v))
		if s == "" {
			continue
		}
		if n, err := strconv.ParseInt(s, 10, 64); err == nil && n != 0 {
			return n
		}
	}
	return 0
}

func gameTitleFromMap(m map[string]any) string {
	for _, key := range []string{"name", "title", "game_name", "gameName", "label"} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
}

func gameTypeFromMap(m map[string]any) string {
	for _, key := range []string{
		"type", "game_type", "gameType", "gametype",
		"vertical", "game_vertical", "gameVertical",
		"game_category", "gameCategory",
		"category",
	} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
}

func providerSystemFromMap(m map[string]any) string {
	for _, key := range []string{"system", "provider_system", "brand", "software", "vendor", "provider"} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" && !isBlueOceanAggregatorSlug(s) {
			return s
		}
	}
	return ""
}

// isBlueOceanAggregatorSlug is true when the catalog uses the integration id where we expect a studio name.
func isBlueOceanAggregatorSlug(s string) bool {
	return strings.EqualFold(strings.TrimSpace(s), "blueocean")
}

func idHashFromMap(m map[string]any) string {
	for _, key := range []string{"id_hash", "idHash", "hash", "game_hash"} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
}

func subcategoryFromMap(m map[string]any) string {
	for _, key := range []string{"subcategory", "sub_category", "subCategory", "game_subcategory", "gameSubcategory"} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
}

// extractThumbnailFromNestedMap resolves URLs inside thumbnail/image/gfx objects (common in aggregator payloads).
func extractThumbnailFromNestedMap(m map[string]any) string {
	ordered := []string{
		"url", "src", "path", "href", "default", "large", "medium", "small",
		"square", "portrait", "landscape", "thumbnail", "image", "webp", "jpg", "png",
	}
	for _, k := range ordered {
		if s := strings.TrimSpace(strVal(m[k])); s != "" {
			return s
		}
	}
	for _, vv := range m {
		s := strings.TrimSpace(strVal(vv))
		if s == "" {
			continue
		}
		low := strings.ToLower(s)
		if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") || strings.HasPrefix(s, "//") ||
			strings.HasPrefix(s, "/") {
			return s
		}
	}
	return ""
}

// thumbnailFromMapFlat scans flat string fields only (BOG getGameList + legacy aliases).
// Doc order: https://blueoceangaming.atlassian.net/wiki/spaces/iGPPD/pages/1209172171/1.1+getGameList
func thumbnailFromMapFlat(m map[string]any) string {
	docKeys := []string{
		"image", "image_preview", "image_square", "image_portrait", "image_background", "image_bw",
	}
	for _, k := range docKeys {
		if s := strings.TrimSpace(strVal(m[k])); s != "" {
			return s
		}
	}
	legacyKeys := []string{
		"thumbnail", "thumbnail_url", "thumb", "thumb_url",
		"icon", "icon_url", "cover", "banner", "logo", "game_image", "image_url",
		"picture", "img", "square_image", "portrait_image", "landscape_image",
		"game_thumbnail", "background_image", "preview", "preview_image",
		"tile_image", "lobby_image", "poster", "featured_image",
	}
	for _, k := range legacyKeys {
		if s := strings.TrimSpace(strVal(m[k])); s != "" {
			return s
		}
	}
	return ""
}

// thumbnailFromMap collects image URLs from common BOG / aggregator payload shapes.
func thumbnailFromMap(m map[string]any) string {
	if s := thumbnailFromMapFlat(m); s != "" {
		return s
	}
	// show_additional=true may nest extra fields here.
	for _, nk := range []string{"additional", "Additional"} {
		if sub, ok := m[nk].(map[string]any); ok {
			if s := thumbnailFromMapFlat(sub); s != "" {
				return s
			}
		}
	}

	for _, nk := range []string{"thumbnail", "image", "icons", "gfx", "visuals", "media", "artwork"} {
		raw, ok := m[nk]
		if !ok {
			continue
		}
		switch t := raw.(type) {
		case map[string]any:
			if s := extractThumbnailFromNestedMap(t); s != "" {
				return s
			}
		case []any:
			for _, it := range t {
				mm, ok := it.(map[string]any)
				if !ok {
					continue
				}
				if s := extractThumbnailFromNestedMap(mm); s != "" {
					return s
				}
			}
		}
	}

	raw, ok := m["images"]
	if !ok {
		return ""
	}
	switch im := raw.(type) {
	case map[string]any:
		for _, k := range []string{"square", "thumbnail", "default", "url", "icon", "cover", "portrait", "landscape", "src"} {
			if s := strings.TrimSpace(strVal(im[k])); s != "" {
				return s
			}
		}
	case []any:
		for _, it := range im {
			mm, ok := it.(map[string]any)
			if !ok {
				continue
			}
			for _, k := range []string{"url", "src", "path", "image", "thumbnail"} {
				if s := strings.TrimSpace(strVal(mm[k])); s != "" {
					return s
				}
			}
		}
	}
	return ""
}

// NormalizeCatalogImageURL turns protocol-relative or site-relative paths into absolute URLs for the player app.
func NormalizeCatalogImageURL(s, base string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "//") {
		return "https:" + s
	}
	low := strings.ToLower(s)
	if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
		return s
	}
	if base == "" {
		return s
	}
	if strings.HasPrefix(s, "/") {
		return base + s
	}
	return base + "/" + strings.TrimPrefix(s, "/")
}

func parseJSONFlexible(s string) (any, bool) {
	s = strings.TrimSpace(s)
	if s == "" || (len(s) > 0 && s[0] != '[' && s[0] != '{') {
		return nil, false
	}
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return nil, false
	}
	return v, true
}

// looksLikeGameSlice returns true when arr appears to be a list of game objects (BOG catalog).
func looksLikeGameSlice(arr []any) bool {
	if len(arr) == 0 {
		return false
	}
	first, ok := arr[0].(map[string]any)
	if !ok {
		return false
	}
	if bogIDFromMap(first) != 0 {
		return true
	}
	return gameTitleFromMap(first) != "" && len(first) >= 2
}

// catalogProviderError returns a human message when the upstream payload is an error/not-success envelope.
func catalogProviderError(m map[string]any) string {
	for _, key := range []string{"success", "status", "ok"} {
		if val, exists := m[key]; exists {
			switch t := val.(type) {
			case bool:
				if key == "success" || key == "ok" {
					if !t {
						return pickProviderMessage(m)
					}
				}
			case string:
				low := strings.ToLower(strings.TrimSpace(t))
				if low == "fail" || low == "failed" || low == "error" {
					return pickProviderMessage(m)
				}
			}
		}
	}
	if code, ok := numToInt64(m["error"]); ok && code != 0 {
		msg := pickProviderMessage(m)
		if msg == "" {
			return fmt.Sprintf("upstream error code %d", code)
		}
		return msg
	}
	if msg := strings.TrimSpace(strVal(m["error"])); msg != "" &&
		msg != "0" && !strings.EqualFold(msg, "false") && strings.ToLower(msg) != "null" {
		if len(msg) < 280 {
			return msg
		}
	}
	return ""
}

func pickProviderMessage(m map[string]any) string {
	for _, key := range []string{
		"message", "Message", "msg", "description", "Description",
		"error_description", "error_message", "reason", "text",
	} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
}

func summarizeCatalogRoot(root any, maxKeys int) string {
	m, ok := root.(map[string]any)
	if !ok || maxKeys <= 0 {
		return fmt.Sprintf("%T", root)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) > maxKeys {
		keys = keys[:maxKeys]
		return strings.Join(keys, ", ") + ", …"
	}
	return strings.Join(keys, ", ")
}

func coerceGamesArray(raw any, depth int) []any {
	if depth <= 0 || raw == nil {
		return nil
	}
	switch t := raw.(type) {
	case []any:
		if looksLikeGameSlice(t) {
			return t
		}
		return nil
	case map[string]any:
		preferredKeys := []string{
			"games", "Games", "response", "Response", "data", "Data", "result", "Result",
			"list", "items", "gameList", "GameList", "game_list",
			"catalog", "Catalog", "catalogue", "content", "payload", "body",
			"records", "entities", "rows", "values", "games_list",
		}
		for _, k := range preferredKeys {
			if inner, ok := t[k]; ok {
				if a := coerceGamesArray(inner, depth-1); len(a) > 0 {
					return a
				}
				if s, ok := inner.(string); ok {
					if nested, ok := parseJSONFlexible(s); ok {
						if a := coerceGamesArray(nested, depth-1); len(a) > 0 {
							return a
						}
					}
				}
			}
		}
		lkSeen := map[string]struct{}{
			"games": {}, "gamelist": {}, "gamelisting": {}, "catalog": {},
		}
		for k, inner := range t {
			compact := strings.ToLower(strings.ReplaceAll(k, "_", ""))
			if _, known := lkSeen[compact]; known {
				if a := coerceGamesArray(inner, depth-1); len(a) > 0 {
					return a
				}
				if s, ok := inner.(string); ok {
					if nested, ok := parseJSONFlexible(s); ok {
						if a := coerceGamesArray(nested, depth-1); len(a) > 0 {
							return a
						}
					}
				}
			}
		}
		for _, inner := range t {
			if a := coerceGamesArray(inner, depth-1); len(a) > 0 {
				return a
			}
			if s, ok := inner.(string); ok {
				if nested, ok := parseJSONFlexible(s); ok {
					if a := coerceGamesArray(nested, depth-1); len(a) > 0 {
						return a
					}
				}
			}
		}
	case string:
		if nested, ok := parseJSONFlexible(t); ok {
			return coerceGamesArray(nested, depth-1)
		}
	}
	return nil
}

// ParseCatalogGames extracts game objects from various BOG response shapes.
// imageBase is optional (BLUEOCEAN_IMAGE_BASE_URL) for relative thumbnail paths.
func ParseCatalogGames(response json.RawMessage, imageBase string) ([]CatalogGame, error) {
	var root any
	if err := json.Unmarshal(response, &root); err != nil {
		return nil, fmt.Errorf("blueocean: invalid JSON from provider: %w", err)
	}
	var arr []any
	switch v := root.(type) {
	case []any:
		arr = v
	case map[string]any:
		for _, key := range []string{"response", "games", "data", "result", "list"} {
			if inner, ok := v[key]; ok {
				if a, ok := inner.([]any); ok {
					arr = a
					break
				}
				if m, ok := inner.(map[string]any); ok {
					for _, key2 := range []string{"games", "data", "list", "items"} {
						if a, ok := m[key2].([]any); ok {
							arr = a
							break
						}
					}
				}
				if key == "response" {
					if s, ok := inner.(string); ok {
						if nested, ok := parseJSONFlexible(s); ok {
							if a := coerceGamesArray(nested, 6); len(a) > 0 {
								arr = a
								break
							}
						}
					}
				}
			}
			if len(arr) > 0 {
				break
			}
		}
		if len(arr) == 0 {
			for _, inner := range v {
				if a, ok := inner.([]any); ok && len(a) > 0 {
					if _, ok := a[0].(map[string]any); ok {
						arr = a
						break
					}
				}
			}
		}
		if len(arr) == 0 {
			arr = coerceGamesArray(root, 7)
		}
	default:
		return nil, fmt.Errorf("blueocean: unexpected response root type %T", root)
	}
	if len(arr) == 0 {
		if m, ok := root.(map[string]any); ok {
			if msg := catalogProviderError(m); msg != "" {
				return nil, fmt.Errorf("blueocean: provider returned error: %s", msg)
			}
		}
		sum := summarizeCatalogRoot(root, 18)
		return nil, fmt.Errorf("blueocean: no games array in response (parsed keys/types: %s) — verify getGameList credentials/currency/paging vs provider docs", sum)
	}
	var out []CatalogGame
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		bogID := bogIDFromMap(m)
		if bogID == 0 {
			continue
		}
		idHash := idHashFromMap(m)
		name := gameTitleFromMap(m)
		if name == "" {
			continue
		}
		thumb := NormalizeCatalogImageURL(thumbnailFromMap(m), imageBase)
		g := CatalogGame{
			BogID:               bogID,
			IDHash:              idHash,
			Name:                name,
			GameType:            gameTypeFromMap(m),
			Subcategory:         subcategoryFromMap(m),
			ProviderSystem:      providerSystemFromMap(m),
			IsNew:               boolVal(m["new"]),
			Mobile:              boolVal(m["mobile"]),
			HasJackpot:          boolVal(m["has_jackpot"]),
			FeatureBuySupported: boolVal(m["featurebuy_supported"]),
			PlayForFunSupported: boolVal(m["play_for_fun_supported"]),
			ThumbnailURL:        thumb,
			Raw:                 m,
		}
		out = append(out, g)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("blueocean: parsed zero games")
	}
	return out, nil
}

// theoreticalRTPPercentFromCatalogMap extracts RTP (as a human percent, e.g. 96.5) from getGameList-style
// game objects so we can persist `metadata.theoretical_rtp_pct` for lobby hover (`GET /v1/games` → `effective_rtp_pct`).
func theoreticalRTPPercentFromCatalogMap(m map[string]any) (float64, bool) {
	if m == nil {
		return 0, false
	}
	for _, k := range []string{
		"effective_rtp_pct", "theoretical_rtp_pct", "theoretical_rtp", "effective_rtp",
		"rtp", "rtp_pct", "rtp_percent", "RTP", "return_to_player",
	} {
		if v, ok := m[k]; ok {
			if f, ok := parseFlexibleRTPNumber(v); ok {
				return f, true
			}
		}
	}
	for _, nk := range []string{"additional", "Additional", "meta", "details"} {
		sub, ok := m[nk].(map[string]any)
		if !ok {
			continue
		}
		if f, ok := theoreticalRTPPercentFromCatalogMap(sub); ok {
			return f, true
		}
	}
	return 0, false
}

func parseFlexibleRTPNumber(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return normalizeCatalogRTPPercent(t)
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return 0, false
		}
		return normalizeCatalogRTPPercent(f)
	case string:
		s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(t), "%"))
		if s == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, false
		}
		return normalizeCatalogRTPPercent(f)
	case int:
		return normalizeCatalogRTPPercent(float64(t))
	case int64:
		return normalizeCatalogRTPPercent(float64(t))
	default:
		return 0, false
	}
}

func normalizeCatalogRTPPercent(f float64) (float64, bool) {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	if f > 0 && f <= 1.0+1e-9 {
		f *= 100
	}
	// Real-world casino RTP is almost always in this band; keeps bogus fields from becoming lobby UI noise.
	if f < 70 || f > 100.51 {
		return 0, false
	}
	return math.Round(f*100) / 100, true
}
