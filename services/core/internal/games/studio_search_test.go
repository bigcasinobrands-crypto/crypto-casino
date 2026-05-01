package games

import (
	"slices"
	"testing"
)

func TestStudioSearchPatterns_pragmaticAliases(t *testing.T) {
	p := StudioSearchPatterns("pragmatic")
	if !slices.Contains(p, "%pragmatic%") || !slices.Contains(p, "%pp%") {
		t.Fatalf("expected pragmatic aliases, got %#v", p)
	}
}

func TestStudioSearchPatterns_ppAlias(t *testing.T) {
	p := StudioSearchPatterns("pp")
	if !slices.Contains(p, "%pp%") || !slices.Contains(p, "%pragmatic%") {
		t.Fatalf("expected pp → pragmatic patterns, got %#v", p)
	}
}
