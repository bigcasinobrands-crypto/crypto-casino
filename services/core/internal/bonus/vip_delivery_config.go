package bonus

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// parseTierPromotionVersionsMap reads admin UI shape:
// { "3": { "promotion_version_id": 101 } }
func parseTierPromotionVersionsMap(configJSON []byte) map[int]int64 {
	if len(configJSON) == 0 {
		return nil
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(configJSON, &root); err != nil {
		return nil
	}
	raw, ok := root["tier_promotion_versions"]
	if !ok || len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var m map[string]struct {
		PromotionVersionID int64 `json:"promotion_version_id"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	out := make(map[int]int64)
	for k, v := range m {
		tid, err := strconv.Atoi(strings.TrimSpace(k))
		if err != nil || tid <= 0 || v.PromotionVersionID <= 0 {
			continue
		}
		out[tid] = v.PromotionVersionID
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

type plannedRunEntry struct {
	RunAt              time.Time
	TierPV             map[int]int64
	OriginalArrayIndex int // index in JSON array (stable for removal)
}

func parseVIPRunAtString(runAt string) (time.Time, bool) {
	s := strings.TrimSpace(runAt)
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), true
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC(), true
	}
	return time.Time{}, false
}

func advanceVIPMonthlyFirstOfMonthUTC(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month()+1, 1, u.Hour(), u.Minute(), u.Second(), u.Nanosecond(), time.UTC)
}

// nextRecurringColumn0AfterNow steps the stored next_run_at forward on its cadence (weekly / monthly)
// when column-0 tier_promotion_versions is non-empty, matching admin “recurring first column” behaviour.
func nextRecurringColumn0AfterNow(nowUTC time.Time, pipeline string, nextRun *time.Time, configJSON []byte) *time.Time {
	if nextRun == nil || len(configJSON) == 0 {
		return nil
	}
	if parseTierPromotionVersionsMap(configJSON) == nil {
		return nil
	}
	t := nextRun.UTC()
	const maxSteps = 400
	for i := 0; i < maxSteps && !t.After(nowUTC); i++ {
		switch pipeline {
		case "weekly_bonus":
			t = t.AddDate(0, 0, 7)
		case "monthly_bonus":
			t = advanceVIPMonthlyFirstOfMonthUTC(t)
		default:
			return nil
		}
	}
	if !t.After(nowUTC) {
		return nil
	}
	cp := t
	return &cp
}

// EarliestFutureVIPScheduledInstant is the soonest UTC instant strictly after `now`
// among: a future next_run_at, extrapolated recurring column-0 deliveries when next_run_at
// is stale, and each future planned_runs[].run_at.
func EarliestFutureVIPScheduledInstant(now time.Time, pipeline string, nextRun *time.Time, configJSON []byte) *time.Time {
	nowUTC := now.UTC()
	var best *time.Time
	try := func(t time.Time) {
		t = t.UTC()
		if !t.After(nowUTC) {
			return
		}
		if best == nil || t.Before(*best) {
			cp := t
			best = &cp
		}
	}
	if nextRun != nil {
		try(*nextRun)
	}
	if rec := nextRecurringColumn0AfterNow(nowUTC, pipeline, nextRun, configJSON); rec != nil {
		try(*rec)
	}
	if len(configJSON) == 0 {
		return best
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(configJSON, &root); err != nil {
		return best
	}
	raw, ok := root["planned_runs"]
	if !ok || len(raw) == 0 || string(raw) == "null" {
		return best
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return best
	}
	for _, elem := range arr {
		var pr struct {
			RunAt string `json:"run_at"`
		}
		if err := json.Unmarshal(elem, &pr); err != nil {
			continue
		}
		if tm, ok := parseVIPRunAtString(pr.RunAt); ok {
			try(tm)
		}
	}
	return best
}

// pickDuePlannedRun returns the due planned run with the earliest run_at (UTC) ≤ now.
// ok is false when there is nothing to consume.
func pickDuePlannedRun(configJSON []byte, now time.Time) (*plannedRunEntry, error) {
	if len(configJSON) == 0 {
		return nil, nil
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(configJSON, &root); err != nil {
		return nil, err
	}
	raw, ok := root["planned_runs"]
	if !ok || len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil, fmt.Errorf("planned_runs: %w", err)
	}
	nowUtc := now.UTC()
	var candidates []plannedRunEntry
	for i, elem := range arr {
		var pr struct {
			RunAt string `json:"run_at"`
			Tier  map[string]struct {
				PV int64 `json:"promotion_version_id"`
			} `json:"tier_promotion_versions"`
		}
		if err := json.Unmarshal(elem, &pr); err != nil {
			continue
		}
		t, ok := parseVIPRunAtString(pr.RunAt)
		if !ok {
			continue
		}
		tierPV := make(map[int]int64)
		for tk, tv := range pr.Tier {
			tid, err := strconv.Atoi(strings.TrimSpace(tk))
			if err != nil || tid <= 0 || tv.PV <= 0 {
				continue
			}
			tierPV[tid] = tv.PV
		}
		if t.UTC().After(nowUtc) {
			continue
		}
		candidates = append(candidates, plannedRunEntry{
			RunAt:              t.UTC(),
			TierPV:             tierPV,
			OriginalArrayIndex: i,
		})
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	sort.Slice(candidates, func(a, b int) bool {
		if candidates[a].RunAt.Equal(candidates[b].RunAt) {
			return candidates[a].OriginalArrayIndex < candidates[b].OriginalArrayIndex
		}
		return candidates[a].RunAt.Before(candidates[b].RunAt)
	})
	ent := candidates[0]
	return &ent, nil
}

// removePlannedRunAtIndex removes planned_runs[i] from config JSON; other keys unchanged.
func removePlannedRunAtIndex(configJSON []byte, index int) ([]byte, error) {
	if len(configJSON) == 0 || index < 0 {
		return configJSON, nil
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(configJSON, &root); err != nil {
		return nil, err
	}
	raw, ok := root["planned_runs"]
	if !ok {
		return configJSON, nil
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil, err
	}
	if index >= len(arr) {
		return configJSON, nil
	}
	arr = append(arr[:index], arr[index+1:]...)
	repacked, err := json.Marshal(arr)
	if err != nil {
		return nil, err
	}
	root["planned_runs"] = repacked
	return json.Marshal(root)
}
