package adminops

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseAnalyticsWindow_RangeAlias(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	req := httptest.NewRequest(http.MethodGet, "/?range=7d", nil)
	start, end, all, err := parseAnalyticsWindow(req)
	if err != nil {
		t.Fatal(err)
	}
	if all {
		t.Fatal("expected all_time false")
	}
	if end.Sub(start) < 6*24*time.Hour || end.Sub(start) > 8*24*time.Hour {
		t.Fatalf("unexpected window length: %v to %v", start, end)
	}
	if end.After(now.Add(2*time.Minute)) || end.Before(now.Add(-2*time.Minute)) {
		t.Fatalf("end should be near now: got %v", end)
	}
}
