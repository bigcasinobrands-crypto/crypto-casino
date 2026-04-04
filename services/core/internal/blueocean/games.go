package blueocean

import (
	"encoding/json"
	"fmt"
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
	for _, key := range []string{"type", "game_type", "gameType", "gametype", "category"} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
}

func providerSystemFromMap(m map[string]any) string {
	for _, key := range []string{"system", "provider_system", "brand", "software", "vendor", "provider"} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
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
	for _, key := range []string{"subcategory", "sub_category", "subCategory"} {
		if s := strings.TrimSpace(strVal(m[key])); s != "" {
			return s
		}
	}
	return ""
}

// thumbnailFromMap collects image URLs from common BOG / aggregator payload shapes.
func thumbnailFromMap(m map[string]any) string {
	flatKeys := []string{
		"image_square", "image", "thumbnail", "thumbnail_url", "thumb", "thumb_url",
		"icon", "icon_url", "cover", "banner", "logo", "game_image", "image_url",
		"picture", "img", "square_image", "portrait_image", "landscape_image",
		"game_thumbnail", "background_image", "preview", "preview_image",
	}
	for _, k := range flatKeys {
		if s := strings.TrimSpace(strVal(m[k])); s != "" {
			return s
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

// ParseCatalogGames extracts game objects from various BOG response shapes.
// imageBase is optional (BLUEOCEAN_IMAGE_BASE_URL) for relative thumbnail paths.
func ParseCatalogGames(response json.RawMessage, imageBase string) ([]CatalogGame, error) {
	var root any
	if err := json.Unmarshal(response, &root); err != nil {
		return nil, err
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
	default:
		return nil, fmt.Errorf("blueocean: unexpected response root type")
	}
	if len(arr) == 0 {
		return nil, fmt.Errorf("blueocean: no games array in response")
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
