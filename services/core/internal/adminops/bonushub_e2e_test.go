package adminops

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// TestE2EHttpSimulatePaymentSettledDryRun hits the admin simulate handler (dry run, no grant).
// Requires BONUS_E2E_DATABASE_URL; uses real DB to list published promotions.
func TestE2EHttpSimulatePaymentSettledDryRun(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	h := &Handler{Pool: p}
	body := `{
		"dry_run": true,
		"user_id": "00000000-0000-0000-0000-000000000001",
		"amount_minor": 10000,
		"currency": "USDT",
		"channel": "on_chain_deposit",
		"provider_resource_id": "e2e-sim-1",
		"deposit_index": 1,
		"first_deposit": true
	}`
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/bonushub/simulate-payment-settled", strings.NewReader(body))
	req = req.WithContext(adminapi.WithStaff(req.Context(), "e2e-admin-1", "superadmin"))
	w := httptest.NewRecorder()
	h.bonusHubSimulatePaymentSettled(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["dry_run"] != true {
		t.Fatalf("expected dry_run, got %v", out)
	}
}

// TestE2EHttpSimulatePaymentSettledGrants calls simulate without dry_run with a user + published deposit
// promo and hub deposit intent; expects a new user_bonus_instance (idempotent key per provider + version).
// Requires BONUS_E2E_DATABASE_URL.
func TestE2EHttpSimulatePaymentSettledGrants(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()
	ctx := context.Background()
	uid := uuid.New().String()
	email := "e2e-simdep-" + uid + "@e2e.local"
	if _, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC().Add(-1*time.Hour)); err != nil {
		t.Fatal(err)
	}
	rules := `{
		"trigger": {"type": "deposit", "min_minor": 1, "first_deposit_only": true, "channels": []},
		"reward": {"type": "percent_match", "percent": 10, "cap_minor": 1000000},
		"wagering": {"multiplier": 1, "max_bet_minor": 100000, "game_weight_pct": 100}
	}`
	slug := "e2e-sim-" + uid[:8]
	var promoID int64
	if err := p.QueryRow(ctx, `INSERT INTO promotions (name, slug, status) VALUES ($1, $2, 'draft') RETURNING id`, slug, "slug-sim-"+uid).Scan(&promoID); err != nil {
		t.Fatal(err)
	}
	var pvid int64
	if err := p.QueryRow(ctx, `
		INSERT INTO promotion_versions (promotion_id, version, rules, published_at, bonus_type, priority)
		VALUES ($1, 1, $2::jsonb, now(), 'deposit_match', 100) RETURNING id
	`, promoID, rules).Scan(&pvid); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `INSERT INTO player_bonus_deposit_intents (user_id, promotion_version_id) VALUES ($1::uuid, $2)`, uid, pvid); err != nil {
		t.Fatal(err)
	}
	providerID := "e2e-sim:" + uid
	t.Cleanup(func() {
		_, _ = p.Exec(ctx, `DELETE FROM user_bonus_instances WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM player_bonus_deposit_intents WHERE user_id = $1::uuid`, uid)
		_, _ = p.Exec(ctx, `DELETE FROM promotion_versions WHERE promotion_id = $1`, promoID)
		_, _ = p.Exec(ctx, `DELETE FROM promotions WHERE id = $1`, promoID)
		_, _ = p.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, uid)
	})

	h := &Handler{Pool: p}
	body := fmt.Sprintf(`{
		"dry_run": false,
		"user_id": %q,
		"amount_minor": 10000,
		"currency": "USDT",
		"channel": "on_chain_deposit",
		"provider_resource_id": %q,
		"deposit_index": 1,
		"first_deposit": true
	}`, uid, providerID)
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/bonushub/simulate-payment-settled", strings.NewReader(body))
	req = req.WithContext(adminapi.WithStaff(req.Context(), "e2e-admin-sim", "superadmin"))
	w := httptest.NewRecorder()
	h.bonusHubSimulatePaymentSettled(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["ok"] != true {
		t.Fatalf("expected ok, got %v: %s", out, w.Body.String())
	}
	idem := fmt.Sprintf("bonus:grant:deposit:%s:%d", providerID, pvid)
	var inst string
	if err := p.QueryRow(ctx, `SELECT id::text FROM user_bonus_instances WHERE idempotency_key = $1`, idem).Scan(&inst); err != nil {
		t.Fatalf("expected instance: %v", err)
	}
	if inst == "" {
		t.Fatal("empty instance id")
	}
}

// TestE2EHttpForfeitInstance calls the HTTP handler to forfeit an active instance (same package = direct handler).
func TestE2EHttpForfeitInstance(t *testing.T) {
	res := bonuse2e.NewUserWithFixedNoDepositGrant(t)
	res.RegisterCleanup(t)
	h := &Handler{Pool: res.Pool}
	r := chi.NewRouter()
	r.Post("/bonushub/instances/{id}/forfeit", h.bonusHubForfeitInstance)
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]string{"reason": "e2e forfeit test"})
	req := httptest.NewRequest(http.MethodPost, "/bonushub/instances/"+res.Instance+"/forfeit", &buf)
	req = req.WithContext(adminapi.WithStaff(req.Context(), "e2e-staff-1", "superadmin"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	var st string
	if err := res.Pool.QueryRow(res.Ctx, `SELECT status FROM user_bonus_instances WHERE id = $1::uuid`, res.Instance).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != "forfeited" {
		t.Fatalf("expected forfeited, got %q", st)
	}
}
