package adminops

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/maintenancenotify"
	"github.com/crypto-casino/core/internal/sitegeo"
	"github.com/crypto-casino/core/internal/sitestatus"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `SELECT key, value, updated_at FROM site_settings ORDER BY key`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	grouped := map[string]map[string]any{}
	for rows.Next() {
		var key string
		var value json.RawMessage
		var updatedAt string
		if err := rows.Scan(&key, &value, &updatedAt); err != nil {
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
		if json.Unmarshal(value, &parsed) != nil {
			parsed = string(value)
		}
		grouped[category][key] = map[string]any{"value": parsed, "updated_at": updatedAt}
	}
	writeJSON(w, grouped)
}

func (h *Handler) PatchSettings(w http.ResponseWriter, r *http.Request) {
	staffID, ok := adminapi.StaffIDFromContext(r.Context())
	if !ok {
		adminapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing staff")
		return
	}

	var body struct {
		Key   string `json:"key"`
		Value any    `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "key and value required")
		return
	}

	valBytes, err := json.Marshal(body.Value)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_value", "cannot serialize value")
		return
	}

	ctx := r.Context()
	prevMaintenance := sitestatus.MaintenanceEffectiveDirect(ctx, h.Pool, h.Cfg)

	_, err = h.Pool.Exec(ctx, `
		INSERT INTO site_settings (key, value, updated_at, updated_by)
		VALUES ($1, $2, now(), $3::uuid)
		ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3::uuid
	`, body.Key, valBytes, staffID)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "upsert failed")
		return
	}

	if err := mirrorKillSwitchSetting(ctx, h.Pool, body.Key, body.Value); err != nil {
		log.Printf("settings mirror: key=%s err=%v", body.Key, err)
	}

	k := strings.TrimSpace(body.Key)
	if k == sitegeo.SettingKeyBlockedCountries {
		sitegeo.InvalidateBlockedCountriesCache()
	}
	if k == sitestatus.SettingKeyIPBlacklist || k == sitestatus.SettingKeyIPWhitelist {
		sitestatus.InvalidatePlayerIPAccessCache()
	}
	if k == "system.maintenance_mode" || k == "system.maintenance_until" {
		sitestatus.InvalidateMaintenanceSettingsCache()
	}

	nextMaintenance := sitestatus.MaintenanceEffectiveDirect(ctx, h.Pool, h.Cfg)
	if prevMaintenance && !nextMaintenance {
		if n, ferr := maintenancenotify.FlushPending(ctx, h.Pool, h.Mail, h.Cfg); ferr != nil {
			log.Printf("maintenance_notify flush: %v", ferr)
		} else if n > 0 {
			log.Printf("maintenance_notify flush: sent=%d", n)
		}
	}

	meta, _ := json.Marshal(body)
	h.auditExec(r.Context(), "settings.update", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, meta)
		VALUES ($1::uuid, 'settings.update', 'site_settings', $2)
	`, staffID, meta)

	writeJSON(w, map[string]any{"ok": true})
}

var publicSettingPrefixes = []string{"kill_switch.", "branding.", "feature_flags."}

func (h *Handler) GetSettingsPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), `SELECT key, value FROM site_settings ORDER BY key`)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()

	out := map[string]any{}
	for rows.Next() {
		var key string
		var value json.RawMessage
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		for _, prefix := range publicSettingPrefixes {
			if strings.HasPrefix(key, prefix) {
				var parsed any
				if json.Unmarshal(value, &parsed) != nil {
					parsed = string(value)
				}
				out[key] = parsed
				break
			}
		}
	}
	writeJSON(w, out)
}

func ReadSetting(ctx context.Context, pool *pgxpool.Pool, key string) (json.RawMessage, error) {
	var value json.RawMessage
	err := pool.QueryRow(ctx, `SELECT value FROM site_settings WHERE key = $1`, key).Scan(&value)
	if err != nil {
		return nil, err
	}
	return value, nil
}
