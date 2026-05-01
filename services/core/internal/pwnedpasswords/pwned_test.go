package pwnedpasswords

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChecker_IsCompromised_hit(t *testing.T) {
	// Password "password" has SHA-1 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 → prefix 5BAA6, suffix 1E4C9B93F3F0682250B6CF8331B7EE68FD8
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/range/5BAA6" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("1E4C9B93F3F0682250B6CF8331B7EE68FD8:100\r\n"))
	}))
	defer srv.Close()

	c := &Checker{HTTP: srv.Client()}
	orig := apiRangeBase
	apiRangeBase = srv.URL + "/range/"
	t.Cleanup(func() { apiRangeBase = orig })

	bad, err := c.IsCompromised(context.Background(), "password")
	if err != nil {
		t.Fatal(err)
	}
	if !bad {
		t.Fatal("expected compromised")
	}
}

func TestChecker_IsCompromised_miss(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("000000000000000000000000000000000000000:1\r\n"))
	}))
	defer srv.Close()

	c := &Checker{HTTP: srv.Client()}
	orig := apiRangeBase
	apiRangeBase = srv.URL + "/range/"
	t.Cleanup(func() { apiRangeBase = orig })

	bad, err := c.IsCompromised(context.Background(), "password")
	if err != nil {
		t.Fatal(err)
	}
	if bad {
		t.Fatal("expected not compromised")
	}
}
