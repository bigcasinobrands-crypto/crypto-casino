package webhooks

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/crypto-casino/core/internal/bonuse2e"
	"github.com/crypto-casino/core/internal/config"
	"github.com/google/uuid"
)

// TestIntegrationBlueOceanWalletBalanceByUserUUID verifies BO seamless GET callback resolves
// remote_id when it equals users.id (no blueocean_player_links row yet — common before first launch).
// Requires BONUS_E2E_DATABASE_URL (same as other bonus E2E tests), e.g. docker compose postgres.
func TestIntegrationBlueOceanWalletBalanceByUserUUID(t *testing.T) {
	p, cl := bonuse2e.MustPool(t)
	defer cl()

	ctx := context.Background()
	uid := uuid.New().String()
	email := "bo-bal-" + uid + "@e2e.local"
	_, err := p.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at, terms_accepted_at, terms_version, privacy_version)
		VALUES ($1::uuid, $2, 'x', $3, now(), '1', '1')
	`, uid, email, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, uid)
	})

	salt := "integration-test-salt"
	cfg := &config.Config{BlueOceanCurrency: "EUR", BlueOceanWalletSalt: salt}
	h := HandleBlueOceanWallet(p, cfg, nil)

	q := boSignGET(salt, map[string]string{
		"action":    "balance",
		"remote_id": uid,
	})
	req := httptest.NewRequest("GET", "/api/blueocean/callback?"+q, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	var out struct {
		Status  int    `json:"status"`
		Balance string `json:"balance"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Status != 200 {
		t.Fatalf("expected status 200, got %v body=%s", out.Status, w.Body.String())
	}
	if out.Balance == "" {
		t.Fatalf("expected balance set, got %+v", out)
	}
}
