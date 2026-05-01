package bonus

import (
	"encoding/json"
	"testing"
)

func TestSnapPositiveInt64FromMap(t *testing.T) {
	m := map[string]any{
		"a": float64(100),
		"b": int64(200),
		"c": json.Number("300"),
		"d": " 400 ",
		"e": float64(-1),
		"f": float64(0),
	}
	if snapPositiveInt64FromMap(m, "a") != 100 {
		t.Fatal("float")
	}
	if snapPositiveInt64FromMap(m, "b") != 200 {
		t.Fatal("int64")
	}
	if snapPositiveInt64FromMap(m, "c") != 300 {
		t.Fatal("json.Number")
	}
	if snapPositiveInt64FromMap(m, "d") != 400 {
		t.Fatal("string")
	}
	if snapPositiveInt64FromMap(m, "e") != 0 {
		t.Fatal("negative")
	}
	if snapPositiveInt64FromMap(m, "f") != 0 {
		t.Fatal("zero")
	}
	if snapPositiveInt64FromMap(m, "missing") != 0 {
		t.Fatal("missing")
	}
	if snapPositiveInt64FromMap(nil, "a") != 0 {
		t.Fatal("nil map")
	}
}

func TestSnapPositiveWeightPct(t *testing.T) {
	if snapPositiveWeightPct(map[string]any{"game_weight_pct": float64(50)}, "game_weight_pct") != 50 {
		t.Fatal("50")
	}
	if snapPositiveWeightPct(map[string]any{"game_weight_pct": float64(2000)}, "game_weight_pct") != 1000 {
		t.Fatal("cap 1000")
	}
	if snapPositiveWeightPct(map[string]any{"game_weight_pct": float64(0)}, "game_weight_pct") != 0 {
		t.Fatal("zero")
	}
}
