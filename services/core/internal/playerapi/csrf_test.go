package playerapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/playercookies"
)

func TestPlayerCookieCSRFMiddleware_webhooksExempt(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/passimpay", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.AccessCookieName, Value: "tok"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusAccepted {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_disabled(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: false}
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/wallet/withdraw", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.AccessCookieName, Value: "tok"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusTeapot {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_getBypass(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/wallet/balance", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.AccessCookieName, Value: "tok"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_noSessionCookiesBypass(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/wallet/withdraw", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_exemptAuthPath(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.AccessCookieName, Value: "tok"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_missingTokenForbidden(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	var nextCalled bool
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/wallet/withdraw", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.AccessCookieName, Value: "tok"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if nextCalled {
		t.Fatal("expected handler not to run")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_mismatchForbidden(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	var nextCalled bool
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/wallet/withdraw", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.AccessCookieName, Value: "tok"})
	req.AddCookie(&http.Cookie{Name: playercookies.CSRFCookieName, Value: "aaa"})
	req.Header.Set(playercookies.CSRFHeaderName, "bbb")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if nextCalled {
		t.Fatal("expected handler not to run")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_matchingToken(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/wallet/withdraw", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.AccessCookieName, Value: "tok"})
	tok := "same-token"
	req.AddCookie(&http.Cookie{Name: playercookies.CSRFCookieName, Value: tok})
	req.Header.Set(playercookies.CSRFHeaderName, tok)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_refreshCookieRequiresToken(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	var nextCalled bool
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	}))
	req := httptest.NewRequest(http.MethodPatch, "/v1/auth/profile", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.RefreshCookieName, Value: "ref"})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if nextCalled {
		t.Fatal("expected handler not to run")
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("got status %d", rr.Code)
	}
}

func TestPlayerCookieCSRFMiddleware_patchWithMatchingToken(t *testing.T) {
	cfg := &config.Config{PlayerCookieAuth: true, AppEnv: "development"}
	h := PlayerCookieCSRFMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	tok := "csrf-patch"
	req := httptest.NewRequest(http.MethodPatch, "/v1/auth/profile", nil)
	req.AddCookie(&http.Cookie{Name: playercookies.RefreshCookieName, Value: "ref"})
	req.AddCookie(&http.Cookie{Name: playercookies.CSRFCookieName, Value: tok})
	req.Header.Set(playercookies.CSRFHeaderName, tok)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got status %d", rr.Code)
	}
}
