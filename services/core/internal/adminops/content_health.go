package adminops

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
)

type contentHealthIssue struct {
	Key     string `json:"key"`
	Reason  string `json:"reason"`
	Preview string `json:"preview,omitempty"`
}

func uploadAssetIDFromContentValue(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return ""
	}
	if strings.HasPrefix(v, "blob:") {
		return "blob"
	}

	// Absolute URL -> derive path portion.
	if strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://") {
		idx := strings.Index(v, "/v1/uploads/")
		if idx >= 0 {
			v = v[idx:]
		}
	}

	if strings.HasPrefix(v, "/v1/uploads/") {
		return strings.TrimPrefix(v, "/v1/uploads/")
	}
	if strings.HasPrefix(v, "v1/uploads/") {
		return strings.TrimPrefix(v, "v1/uploads/")
	}
	if strings.HasPrefix(v, "/uploads/") {
		return strings.TrimPrefix(v, "/uploads/")
	}
	if strings.HasPrefix(v, "uploads/") {
		return strings.TrimPrefix(v, "uploads/")
	}
	return ""
}

func (h *Handler) ContentHealth(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `SELECT key, content FROM site_content ORDER BY key`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "content health query failed")
		return
	}
	defer rows.Close()

	type healthSummary struct {
		ContentKeys          int                `json:"content_keys"`
		UploadAssetsStored   int                `json:"upload_assets_stored"`
		UploadRefsChecked    int                `json:"upload_refs_checked"`
		BrokenUploadRefs     int                `json:"broken_upload_refs"`
		BlobRefsDetected     int                `json:"blob_refs_detected"`
		MissingCriticalKeys  []string           `json:"missing_critical_keys"`
		Issues               []contentHealthIssue `json:"issues"`
	}

	summary := healthSummary{
		MissingCriticalKeys: []string{},
		Issues:              []contentHealthIssue{},
	}

	contentRows := map[string]json.RawMessage{}
	for rows.Next() {
		var key string
		var content json.RawMessage
		if scanErr := rows.Scan(&key, &content); scanErr != nil {
			continue
		}
		summary.ContentKeys++
		contentRows[key] = content
	}

	critical := []string{"hero_slides", "auth_desktop_visual_image"}
	for _, key := range critical {
		if _, ok := contentRows[key]; !ok {
			summary.MissingCriticalKeys = append(summary.MissingCriticalKeys, key)
		}
	}

	_ = h.Pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM cms_uploaded_assets`).Scan(&summary.UploadAssetsStored)

	// Check hero slide images.
	if raw, ok := contentRows["hero_slides"]; ok {
		var slides []map[string]any
		if json.Unmarshal(raw, &slides) == nil {
			for _, slide := range slides {
				img, _ := slide["image_url"].(string)
				id := uploadAssetIDFromContentValue(img)
				if id == "" {
					continue
				}
				if id == "blob" {
					summary.BlobRefsDetected++
					summary.Issues = append(summary.Issues, contentHealthIssue{
						Key:    "hero_slides",
						Reason: "blob_url_detected",
						Preview: img,
					})
					continue
				}
				summary.UploadRefsChecked++
				var exists bool
				_ = h.Pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM cms_uploaded_assets WHERE id = $1)`, id).Scan(&exists)
				if !exists {
					summary.BrokenUploadRefs++
					summary.Issues = append(summary.Issues, contentHealthIssue{
						Key:    "hero_slides",
						Reason: "missing_upload_asset",
						Preview: id,
					})
				}
			}
		}
	}

	// Check auth visual image.
	if raw, ok := contentRows["auth_desktop_visual_image"]; ok {
		var value string
		if json.Unmarshal(raw, &value) == nil {
			id := uploadAssetIDFromContentValue(value)
			if id == "blob" {
				summary.BlobRefsDetected++
				summary.Issues = append(summary.Issues, contentHealthIssue{
					Key:    "auth_desktop_visual_image",
					Reason: "blob_url_detected",
					Preview: value,
				})
			} else if id != "" {
				summary.UploadRefsChecked++
				var exists bool
				_ = h.Pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM cms_uploaded_assets WHERE id = $1)`, id).Scan(&exists)
				if !exists {
					summary.BrokenUploadRefs++
					summary.Issues = append(summary.Issues, contentHealthIssue{
						Key:    "auth_desktop_visual_image",
						Reason: "missing_upload_asset",
						Preview: id,
					})
				}
			}
		}
	}

	writeJSON(w, map[string]any{
		"ok":      summary.BrokenUploadRefs == 0 && summary.BlobRefsDetected == 0 && len(summary.MissingCriticalKeys) == 0,
		"summary": summary,
	})
}
