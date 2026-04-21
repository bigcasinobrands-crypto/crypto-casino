package adminops

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (h *Handler) bonusHubListRewardPrograms(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Pool.Query(ctx, `
		SELECT id, program_key, kind, promotion_version_id, config, enabled, priority, created_at, updated_at
		FROM reward_programs ORDER BY priority DESC, id ASC LIMIT 500
	`)
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, pvid int64
		var key, kind string
		var config []byte
		var en bool
		var pri int
		var ca, ua interface{}
		if err := rows.Scan(&id, &key, &kind, &pvid, &config, &en, &pri, &ca, &ua); err != nil {
			continue
		}
		var cfg any
		_ = json.Unmarshal(config, &cfg)
		list = append(list, map[string]any{
			"id": id, "program_key": key, "kind": kind, "promotion_version_id": pvid,
			"config": cfg, "enabled": en, "priority": pri, "created_at": ca, "updated_at": ua,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"programs": list})
}

type rewardProgramCreateBody struct {
	ProgramKey         string          `json:"program_key"`
	Kind               string          `json:"kind"`
	PromotionVersionID int64           `json:"promotion_version_id"`
	Config             json.RawMessage `json:"config"`
	Enabled            *bool           `json:"enabled"`
	Priority           *int            `json:"priority"`
}

func (h *Handler) bonusHubCreateRewardProgram(w http.ResponseWriter, r *http.Request) {
	var body rewardProgramCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	key := strings.TrimSpace(body.ProgramKey)
	kind := strings.TrimSpace(body.Kind)
	if key == "" || kind == "" || body.PromotionVersionID <= 0 {
		http.Error(w, "program_key, kind, promotion_version_id required", http.StatusBadRequest)
		return
	}
	cfg := body.Config
	if len(cfg) == 0 {
		cfg = []byte("{}")
	}
	en := true
	if body.Enabled != nil {
		en = *body.Enabled
	}
	pri := 0
	if body.Priority != nil {
		pri = *body.Priority
	}
	var id int64
	err := h.Pool.QueryRow(r.Context(), `
		INSERT INTO reward_programs (program_key, kind, promotion_version_id, config, enabled, priority)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6)
		RETURNING id
	`, key, kind, body.PromotionVersionID, string(cfg), en, pri).Scan(&id)
	if err != nil {
		http.Error(w, "insert failed", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}
