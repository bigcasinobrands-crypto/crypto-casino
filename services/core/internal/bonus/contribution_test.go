package bonus

import (
	"encoding/json"
	"testing"
)

func TestContributionWeightFromWeightsMap_perGameBeatsCategory(t *testing.T) {
	m := map[string]any{
		"per_game": map[string]any{"abc-slot": float64(40)},
		"slots":    float64(100),
	}
	w, ok := contributionWeightFromWeightsMap(m, "ABC-Slot", "slots")
	if !ok || w != 40 {
		t.Fatalf("expected per_game 40, ok=%v got %d", ok, w)
	}
}

func TestContributionWeightFromWeightsMap_categoryThenDefault(t *testing.T) {
	m := map[string]any{
		"slots":   float64(75),
		"default": float64(50),
	}
	w, ok := contributionWeightFromWeightsMap(m, "", "slots")
	if !ok || w != 75 {
		t.Fatalf("expected category 75, ok=%v got %d", ok, w)
	}
	m2 := map[string]any{"default": json.Number("60")}
	w2, ok2 := contributionWeightFromWeightsMap(m2, "unknown-game", "live")
	if !ok2 || w2 != 60 {
		t.Fatalf("expected default 60, ok=%v got %d", ok2, w2)
	}
}

func TestContributionWeightFromWeightsMap_stringCoerce(t *testing.T) {
	m := map[string]any{
		"per_game": map[string]any{"g1": "25"},
	}
	w, ok := contributionWeightFromWeightsMap(m, "g1", "slots")
	if !ok || w != 25 {
		t.Fatalf("expected 25, ok=%v got %d", ok, w)
	}
}

func TestContributionWeightFromWeightsMap_clamp(t *testing.T) {
	m := map[string]any{"slots": float64(150)}
	w, ok := contributionWeightFromWeightsMap(m, "", "slots")
	if !ok || w != 100 {
		t.Fatalf("expected clamp 100, got %d ok=%v", w, ok)
	}
}

func TestCoerceContributionPct(t *testing.T) {
	if coerceContributionPct(float64(42.9)) != 42 {
		t.Fatal("float")
	}
	if coerceContributionPct(int64(7)) != 7 {
		t.Fatal("int64")
	}
	n := json.Number("99")
	if coerceContributionPct(n) != 99 {
		t.Fatal("json.Number int")
	}
	if coerceContributionPct(json.Number("3.5")) != 3 {
		t.Fatal("json.Number float trunc")
	}
	if coerceContributionPct(" 88 ") != 88 {
		t.Fatal("string")
	}
	if coerceContributionPct("x") >= 0 {
		t.Fatal("bad string")
	}
	if coerceContributionPct(struct{}{}) >= 0 {
		t.Fatal("unknown type")
	}
}
