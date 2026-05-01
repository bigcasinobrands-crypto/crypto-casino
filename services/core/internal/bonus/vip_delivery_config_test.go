package bonus

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseTierPromotionVersionsMap(t *testing.T) {
	raw := []byte(`{"tier_promotion_versions":{"1":{"promotion_version_id":7},"3":{"promotion_version_id":42}},"other":true}`)
	m := parseTierPromotionVersionsMap(raw)
	if len(m) != 2 || m[1] != 7 || m[3] != 42 {
		t.Fatalf("unexpected map: %+v", m)
	}
	if parseTierPromotionVersionsMap([]byte(`{}`)) != nil {
		t.Fatal("expected nil")
	}
}

func TestEarliestFutureVIPScheduledInstant(t *testing.T) {
	now := time.Date(2026, 4, 26, 12, 0, 0, 0, time.UTC)

	futureNr := time.Date(2026, 4, 30, 18, 0, 0, 0, time.UTC)
	got := EarliestFutureVIPScheduledInstant(now, "weekly_bonus", &futureNr, []byte(`{}`))
	if got == nil || !got.Equal(futureNr) {
		t.Fatalf("want %v got %v", futureNr, got)
	}

	pastNr := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	cfg := []byte(`{"planned_runs":[
		{"run_at":"2026-04-27T01:00:00Z","tier_promotion_versions":{"1":{"promotion_version_id":9}}},
		{"run_at":"2026-05-02T15:30:00Z","tier_promotion_versions":{"2":{"promotion_version_id":8}}}
	]}`)
	want := time.Date(2026, 4, 27, 1, 0, 0, 0, time.UTC)
	got2 := EarliestFutureVIPScheduledInstant(now, "weekly_bonus", &pastNr, cfg)
	if got2 == nil || !got2.Equal(want) {
		t.Fatalf("stale anchor + planned: want %v got %v", want, got2)
	}

	earlyPlanned := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	laterNr := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	cfgMixed := []byte(`{"planned_runs":[
		{"run_at":"` + earlyPlanned.Format(time.RFC3339) + `","tier_promotion_versions":{"1":{"promotion_version_id":1}}},
		{"run_at":"2026-06-01T12:00:00Z","tier_promotion_versions":{"1":{"promotion_version_id":1}}}
	]}`)
	got3 := EarliestFutureVIPScheduledInstant(now, "weekly_bonus", &laterNr, cfgMixed)
	if got3 == nil || !got3.Equal(laterNr) {
		t.Fatalf("min of future anchors: want next_run %v got %v", laterNr, got3)
	}

	// Stale weekly next_run_at with column-0 tier PV → next Monday slot (Matches May 4 when anchor was Apr 27).
	apr30 := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	anchorPast := time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC)
	cfgCol0 := []byte(`{"tier_promotion_versions":{"1":{"promotion_version_id":9}}}`)
	wantMay4 := time.Date(2026, 5, 4, 0, 0, 0, 0, time.UTC)
	got4 := EarliestFutureVIPScheduledInstant(apr30, "weekly_bonus", &anchorPast, cfgCol0)
	if got4 == nil || !got4.Equal(wantMay4) {
		t.Fatalf("weekly recurrence from stale next_run_at: want %v got %v", wantMay4, got4)
	}

	// Monthly: advance month on 1st with same UTC clock as stored anchor (column-0 recurrence).
	anchorApr1 := time.Date(2026, 4, 1, 13, 30, 0, 0, time.UTC)
	mayWant := time.Date(2026, 5, 1, 13, 30, 0, 0, time.UTC)
	got5 := EarliestFutureVIPScheduledInstant(apr30, "monthly_bonus", &anchorApr1, cfgCol0)
	if got5 == nil || !got5.Equal(mayWant) {
		t.Fatalf("monthly recurrence: want %v got %v", mayWant, got5)
	}
}

func TestPickDuePlannedRun(t *testing.T) {
	now := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	cfg := []byte(`{"planned_runs":[
		{"run_at":"2026-06-01T00:00:00Z","tier_promotion_versions":{"1":{"promotion_version_id":9}}},
		{"run_at":"2026-05-01T00:00:00Z","tier_promotion_versions":{"2":{"promotion_version_id":8}}}
	]}`)
	ent, err := pickDuePlannedRun(cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	if ent == nil {
		t.Fatal("expected due run")
	}
	if ent.OriginalArrayIndex != 1 {
		t.Fatalf("want index 1 (earlier May run), got %d", ent.OriginalArrayIndex)
	}
	if ent.TierPV[2] != 8 {
		t.Fatalf("unexpected tier map %+v", ent.TierPV)
	}

	futureCfg := []byte(`{"planned_runs":[{"run_at":"2026-12-01T00:00:00Z","tier_promotion_versions":{"1":{"promotion_version_id":1}}}]}`)
	ent2, err := pickDuePlannedRun(futureCfg, now)
	if err != nil || ent2 != nil {
		t.Fatalf("expected none due, got %v err=%v", ent2, err)
	}
}

func TestRemovePlannedRunAtIndex(t *testing.T) {
	cfg := []byte(`{"planned_runs":[{"run_at":"a"},{"run_at":"b"},{"run_at":"c"}],"x":true}`)
	out, err := removePlannedRunAtIndex(cfg, 1)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatal(err)
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(m["planned_runs"], &arr); err != nil {
		t.Fatal(err)
	}
	if len(arr) != 2 {
		t.Fatalf("len %d", len(arr))
	}
	var x bool
	if err := json.Unmarshal(m["x"], &x); err != nil || !x {
		t.Fatalf("x preserved: %v err=%v", x, err)
	}
}
