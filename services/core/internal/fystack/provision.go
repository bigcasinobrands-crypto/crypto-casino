package fystack

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// WalletProvisioner creates a Fystack MPC wallet per user and stores fystack_wallets.
type WalletProvisioner struct {
	Pool   *pgxpool.Pool
	Client *Client
}

func (p *WalletProvisioner) Provision(ctx context.Context, userID string) error {
	if p == nil || p.Pool == nil || p.Client == nil {
		return nil
	}
	uid := strings.TrimSpace(userID)
	if uid == "" {
		return nil
	}
	var exists bool
	_ = p.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM fystack_wallets WHERE user_id = $1::uuid)`, uid).Scan(&exists)
	if exists {
		return nil
	}
	name := "player-" + uid
	if len(uid) > 8 {
		name = "player-" + uid[:8]
	}
	resp, st, err := p.Client.CreateWallet(ctx, name, "standard")
	if err != nil {
		log.Printf("fystack provision user=%s: %v", uid, err)
		return err
	}
	if st < 200 || st >= 300 {
		log.Printf("fystack provision user=%s: HTTP %d %v", uid, st, truncate(fmt.Sprint(resp), 120))
		return fmt.Errorf("fystack create wallet: status %d", st)
	}
	wid := ExtractWalletID(resp)
	if wid == "" {
		raw, _ := json.Marshal(resp)
		log.Printf("fystack provision user=%s: no wallet_id in body %s", uid, truncate(string(raw), 300))
		return fmt.Errorf("fystack: missing wallet_id in response")
	}
	raw, _ := json.Marshal(resp)
	_, err = p.Pool.Exec(ctx, `
		INSERT INTO fystack_wallets (user_id, provider_wallet_id, status, raw)
		VALUES ($1::uuid, $2, 'active', $3::jsonb)
		ON CONFLICT (user_id) DO NOTHING
	`, uid, wid, raw)
	if err != nil {
		return err
	}
	return nil
}
