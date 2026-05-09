package adminops

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/go-chi/chi/v5"
)

func TestPatchReferralProgramTierForbiddenWithoutSuperadmin(t *testing.T) {
	h := &Handler{Pool: nil}
	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := adminapi.WithStaff(req.Context(), "staff-1", "admin")
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}).With(adminapi.RequireAnyRole("superadmin")).Patch("/referrals/tiers/{id}", h.patchReferralProgramTier)

	req := httptest.NewRequest(http.MethodPatch, "/referrals/tiers/1", strings.NewReader(`{"name":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
}
