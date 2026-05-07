package adminops

import (
	"encoding/json"
	"fmt"
	"io"
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/safepath"
	"github.com/jackc/pgx/v5"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) GetAllContent(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `SELECT key, content, updated_at FROM site_content ORDER BY key`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	grouped := map[string]map[string]any{}
	for rows.Next() {
		var key string
		var content json.RawMessage
		var updatedAt string
		if err := rows.Scan(&key, &content, &updatedAt); err != nil {
			continue
		}
		category := key
		if idx := strings.Index(key, "."); idx > 0 {
			category = key[:idx]
		}
		if grouped[category] == nil {
			grouped[category] = map[string]any{}
		}
		var parsed any
		if json.Unmarshal(content, &parsed) != nil {
			parsed = string(content)
		}
		grouped[category][key] = map[string]any{"content": parsed, "updated_at": updatedAt}
	}
	writeJSON(w, grouped)
}

func (h *Handler) GetContentByKey(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	if key == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "key required")
		return
	}

	var content json.RawMessage
	var updatedAt time.Time
	err := h.Pool.QueryRow(r.Context(), `SELECT content, updated_at FROM site_content WHERE key = $1`, key).Scan(&content, &updatedAt)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "content key not found")
		return
	}

	var parsed any
	if json.Unmarshal(content, &parsed) != nil {
		parsed = string(content)
	}
	writeJSON(w, map[string]any{"key": key, "content": parsed, "updated_at": updatedAt.UTC().Format(time.RFC3339)})
}

func (h *Handler) PutContent(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}

	key := chi.URLParam(r, "key")
	if key == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "key required")
		return
	}

	var body struct {
		Content any `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}

	contentBytes, err := json.Marshal(body.Content)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_content", "cannot serialize content")
		return
	}

	_, err = h.Pool.Exec(r.Context(), `
		INSERT INTO site_content (key, content, updated_at, updated_by)
		VALUES ($1, $2, now(), $3::uuid)
		ON CONFLICT (key) DO UPDATE SET content = $2, updated_at = now(), updated_by = $3::uuid
	`, key, contentBytes, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "upsert failed")
		return
	}

	meta, _ := json.Marshal(map[string]any{"key": key})
	h.auditExec(r.Context(), "content.update", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'content.update', 'site_content', $2)
	`, staffID, meta)

	writeJSON(w, map[string]any{"ok": true})
}

const maxUploadSize = 10 << 20 // 10 MB

var allowedImageTypes = map[string]bool{
	"image/jpeg":    true,
	"image/png":     true,
	"image/gif":     true,
	"image/svg+xml": true,
	"image/webp":    true,
}

func (h *Handler) UploadContentImage(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "too_large", "file exceeds 10MB limit")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "missing_file", "file field required")
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "fs_error", "read failed")
		return
	}
	if len(fileBytes) == 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "empty_file", "file is empty")
		return
	}
	ct := header.Header.Get("Content-Type")
	sniffed := http.DetectContentType(fileBytes)
	if sniffed != "" {
		ct = sniffed
	}
	if !allowedImageTypes[ct] {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_type", "only image files are accepted")
		return
	}

	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".bin"
	}
	filename := fmt.Sprintf("%d_%s%s", time.Now().UnixMilli(), staffID[:8], ext)

	_, err = h.Pool.Exec(r.Context(), `
		INSERT INTO cms_uploaded_assets (id, content_type, data, created_by)
		VALUES ($1, $2, $3, $4::uuid)
		ON CONFLICT (id) DO UPDATE
		SET content_type = EXCLUDED.content_type,
		    data = EXCLUDED.data,
		    created_by = EXCLUDED.created_by,
		    created_at = now()
	`, filename, ct, fileBytes, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "cannot store upload")
		return
	}

	// Legacy disk write for backwards compatibility with existing operational tooling.
	uploadDir := filepath.Join(h.Cfg.DataDir, "uploads")
	_ = os.MkdirAll(uploadDir, 0o755)
	fullPath := filepath.Join(uploadDir, filename)
	if safepath.Within(uploadDir, fullPath) {
		_ = os.WriteFile(fullPath, fileBytes, 0o644)
	}

	out := "/v1/uploads/" + filename
	writeJSON(w, map[string]any{"url": bonus.PublicizeStoredAssetURL(out)})
}

func (h *Handler) ServeUploadedContent(w http.ResponseWriter, r *http.Request) {
	fileID := strings.TrimSpace(chi.URLParam(r, "*"))
	fileID = strings.TrimPrefix(fileID, "/")
	fileID = path.Base(fileID)
	if fileID == "" || fileID == "." || fileID == ".." {
		http.NotFound(w, r)
		return
	}

	var contentType string
	var data []byte
	err := h.Pool.QueryRow(r.Context(), `
		SELECT content_type, data
		FROM cms_uploaded_assets
		WHERE id = $1
	`, fileID).Scan(&contentType, &data)
	if err == nil {
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(data)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "upload read error", http.StatusInternalServerError)
		return
	}

	// Fallback for older uploads that exist only on disk.
	uploadDir := filepath.Join(h.Cfg.DataDir, "uploads")
	fullPath := filepath.Join(uploadDir, fileID)
	if !safepath.Within(uploadDir, fullPath) {
		http.NotFound(w, r)
		return
	}
	fileBytes, readErr := os.ReadFile(fullPath)
	if readErr != nil || len(fileBytes) == 0 {
		http.NotFound(w, r)
		return
	}

	legacyContentType := http.DetectContentType(fileBytes)
	if !allowedImageTypes[legacyContentType] {
		http.NotFound(w, r)
		return
	}

	// Auto-backfill legacy disk asset into DB so future deploys/restarts remain safe.
	_, _ = h.Pool.Exec(r.Context(), `
		INSERT INTO cms_uploaded_assets (id, content_type, data, created_by)
		VALUES ($1, $2, $3, NULL)
		ON CONFLICT (id) DO NOTHING
	`, fileID, legacyContentType, fileBytes)

	w.Header().Set("Content-Type", legacyContentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(fileBytes)
}

func (h *Handler) ContentBundle(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `SELECT key, content FROM site_content ORDER BY key`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	bundle := map[string]any{}
	for rows.Next() {
		var key string
		var content json.RawMessage
		if err := rows.Scan(&key, &content); err != nil {
			continue
		}
		var parsed any
		if json.Unmarshal(content, &parsed) != nil {
			parsed = string(content)
		}
		bundle[key] = parsed
	}

	w.Header().Set("Cache-Control", "no-store, must-revalidate")
	writeJSON(w, bundle)
}

func (h *Handler) ContentByKeyPublic(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	if key == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "key required")
		return
	}

	var content json.RawMessage
	err := h.Pool.QueryRow(r.Context(), `SELECT content FROM site_content WHERE key = $1`, key).Scan(&content)
	if err != nil {
		adminapi.WriteError(w, http.StatusNotFound, "not_found", "content key not found")
		return
	}

	var parsed any
	if json.Unmarshal(content, &parsed) != nil {
		parsed = string(content)
	}

	w.Header().Set("Cache-Control", "no-store, must-revalidate")
	writeJSON(w, map[string]any{"key": key, "content": parsed})
}
