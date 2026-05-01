package adminops

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) listVIPDeliverySchedules(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Ensure pipelines exist even if migrations were skipped or rows were truncated.
	if _, err := h.Pool.Exec(ctx, `
		INSERT INTO vip_delivery_schedules (pipeline, enabled, config)
		VALUES ('weekly_bonus', false, '{}'), ('monthly_bonus', false, '{}')
		ON CONFLICT (pipeline) DO NOTHING
	`); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	rows, err := h.Pool.Query(ctx, `
		SELECT pipeline, enabled, COALESCE(config, '{}'::jsonb), next_run_at, updated_at
		FROM vip_delivery_schedules
		ORDER BY pipeline ASC
	`)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var schedules []map[string]any
	for rows.Next() {
		var pipeline string
		var enabled bool
		var cfg []byte
		var next, updated *time.Time
		if err := rows.Scan(&pipeline, &enabled, &cfg, &next, &updated); err != nil {
			continue
		}
		var cfgObj map[string]any
		_ = json.Unmarshal(cfg, &cfgObj)
		if cfgObj == nil {
			cfgObj = map[string]any{}
		}
		row := map[string]any{
			"pipeline": pipeline,
			"enabled":  enabled,
			"config":   cfgObj,
		}
		if next != nil {
			row["next_run_at"] = next.UTC().Format(time.RFC3339)
		}
		if updated != nil {
			row["updated_at"] = updated.UTC().Format(time.RFC3339)
		}
		schedules = append(schedules, row)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"schedules": schedules})
}

type vipDeliverySchedulePatch struct {
	Enabled   *bool           `json:"enabled"`
	NextRunAt *string         `json:"next_run_at"`
	Config    json.RawMessage `json:"config"`
}

func promotionVersionIDsFromTierMap(m map[string]any) map[int]struct{} {
	out := make(map[int]struct{})
	for _, v := range m {
		om, ok := v.(map[string]any)
		if !ok {
			continue
		}
		var n float64
		switch x := om["promotion_version_id"].(type) {
		case float64:
			n = x
		case json.Number:
			if f, err := x.Float64(); err == nil {
				n = f
			}
		}
		if n <= 0 || n != float64(int64(n)) {
			continue
		}
		out[int(n)] = struct{}{}
	}
	return out
}

func promotionVersionIDsFromPlannedRow(tierPV map[string]any) map[int]struct{} {
	return promotionVersionIDsFromTierMap(tierPV)
}

// validateVIPScheduleNoDupPromoSameInstant blocks the same promotion_version_id at the same UTC instant
// across planned_runs and optional column-0 next_run_at (mirrors admin-console schedule matrix).
func validateVIPScheduleNoDupPromoSameInstant(cfgJSON []byte, nextRun *time.Time, automationEnabled bool) string {
	var cfg map[string]any
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil || cfg == nil {
		return ""
	}
	counts := map[string]int{} // "unix|pv"
	bump := func(t time.Time, pv int) {
		if pv <= 0 {
			return
		}
		u := t.UTC().Unix()
		k := fmt.Sprintf("%d\x01%d", u, pv)
		counts[k]++
	}

	// Column 0 + next run window
	if automationEnabled && nextRun != nil {
		tm := nextRun.UTC()
		raw, ok := cfg["tier_promotion_versions"].(map[string]any)
		if ok {
			for pv := range promotionVersionIDsFromTierMap(raw) {
				bump(tm, pv)
			}
		}
	}

	rawRuns, ok := cfg["planned_runs"].([]any)
	if !ok {
		rawRuns = nil
	}
	for _, item := range rawRuns {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		rs, _ := row["run_at"].(string)
		rs = strings.TrimSpace(rs)
		if rs == "" {
			continue
		}
		tm, err := time.Parse(time.RFC3339Nano, rs)
		if err != nil {
			tm, err = time.Parse(time.RFC3339, rs)
			if err != nil {
				continue
			}
		}
		tierPV, ok := row["tier_promotion_versions"].(map[string]any)
		if !ok {
			continue
		}
		for pv := range promotionVersionIDsFromPlannedRow(tierPV) {
			bump(tm.UTC(), pv)
		}
	}

	for k, c := range counts {
		if c <= 1 {
			continue
		}
		idx := strings.Index(k, "\x01")
		if idx < 0 {
			continue
		}
		unixStr, pvStr := k[:idx], k[idx+1:]
		sec, _ := strconv.ParseInt(unixStr, 10, 64)
		when := time.Unix(sec, 0).UTC().Format(time.RFC3339)
		return fmt.Sprintf("promotion_version %s is assigned more than once for the same delivery time (%s UTC); use different times or bonuses", pvStr, when)
	}
	return ""
}

func (h *Handler) patchVIPDeliverySchedule(w http.ResponseWriter, r *http.Request) {
	pipeline := strings.TrimSpace(chi.URLParam(r, "pipeline"))
	if pipeline == "" || (pipeline != "weekly_bonus" && pipeline != "monthly_bonus") {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_pipeline", "pipeline must be weekly_bonus or monthly_bonus")
		return
	}
	var body vipDeliverySchedulePatch
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}

	ctx := r.Context()

	var prevEnabled bool
	var prevCfg []byte
	var prevNext *time.Time
	err := h.Pool.QueryRow(ctx,
		`SELECT enabled, COALESCE(config,'{}'::jsonb), next_run_at FROM vip_delivery_schedules WHERE pipeline = $1`,
		pipeline,
	).Scan(&prevEnabled, &prevCfg, &prevNext)
	if err == pgx.ErrNoRows {
		playerapi.WriteError(w, http.StatusNotFound, "not_found", "pipeline not found")
		return
	}
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	nextEnabled := prevEnabled
	if body.Enabled != nil {
		nextEnabled = *body.Enabled
	}

	nextCfgJSON := prevCfg
	if len(body.Config) > 0 && string(body.Config) != "null" {
		if !json.Valid(body.Config) {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_config", "must be JSON")
			return
		}
		nextCfgJSON = body.Config
	}

	nextNext := prevNext
	if body.NextRunAt != nil {
		raw := strings.TrimSpace(*body.NextRunAt)
		if raw != "" {
			t, parseErr := time.Parse(time.RFC3339, raw)
			if parseErr != nil {
				playerapi.WriteError(w, http.StatusBadRequest, "bad_next_run_at", parseErr.Error())
				return
			}
			nextNext = &t
		} else {
			nextNext = nil
		}
	}

	if msg := validateVIPScheduleNoDupPromoSameInstant(nextCfgJSON, nextNext, nextEnabled); msg != "" {
		playerapi.WriteError(w, http.StatusBadRequest, "duplicate_schedule", msg)
		return
	}

	var updatedAt time.Time
	var outCfg []byte
	var outNext *time.Time
	uerr := h.Pool.QueryRow(ctx, `
		UPDATE vip_delivery_schedules
		SET enabled = $2::boolean,
		    config = COALESCE($3::jsonb,'{}'::jsonb),
		    next_run_at = $4,
		    updated_at = now()
		WHERE pipeline = $1::text
		RETURNING enabled, COALESCE(config,'{}'::jsonb), next_run_at, updated_at`,
		pipeline, nextEnabled, nextCfgJSON, nextNext,
	).Scan(&nextEnabled, &outCfg, &outNext, &updatedAt)
	if uerr != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	var cfgObj map[string]any
	_ = json.Unmarshal(outCfg, &cfgObj)
	if cfgObj == nil {
		cfgObj = map[string]any{}
	}
	row := map[string]any{
		"pipeline": pipeline,
		"enabled":  nextEnabled,
		"config":   cfgObj,
		"updated_at": updatedAt.UTC().Format(time.RFC3339),
	}
	if outNext != nil {
		row["next_run_at"] = outNext.UTC().Format(time.RFC3339)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"schedule": row})
}
