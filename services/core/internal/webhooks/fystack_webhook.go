package webhooks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// HandleFystackWebhook verifies workspace/checkout webhooks (Ed25519 + canonical JSON when a public key is available:
// FYSTACK_WEBHOOK_VERIFICATION_KEY pin, else API webhook-verification-key via client),
// or legacy HMAC (WEBHOOK_FYSTACK_SECRET) for flat payloads. Persists deduped deliveries and enqueues processing.
func HandleFystackWebhook(pool *pgxpool.Pool, rdb *redis.Client, client *fystack.Client, hmacSecret string, webhookPubKeyHex string) http.HandlerFunc {
	hmacSecret = strings.TrimSpace(hmacSecret)
	webhookPubKeyHex = strings.TrimSpace(webhookPubKeyHex)
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		var m map[string]any
		if err := json.Unmarshal(body, &m); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		eventType := strings.TrimSpace(r.Header.Get("X-Webhook-Event"))
		if eventType == "" {
			eventType = strings.TrimSpace(str(m["event"]))
		}
		_, hasPayload := m["payload"].(map[string]any)
		unified := hasPayload && eventType != ""

		canEd25519 := webhookPubKeyHex != "" || (client != nil && client.BaseURL != "")
		if unified && canEd25519 {
			sig := strings.TrimSpace(r.Header.Get("X-Webhook-Signature"))
			pub := webhookPubKeyHex
			var kerr error
			if pub == "" {
				pub, kerr = client.WebhookPublicKeyCached(r.Context(), 0)
				if kerr != nil {
					log.Printf("fystack webhook: pubkey: %v", kerr)
					http.Error(w, "verification unavailable", http.StatusInternalServerError)
					return
				}
			}
			if err := fystack.VerifyWorkspaceWebhook(pub, body, sig); err != nil {
				log.Printf("fystack webhook: verify: %v", err)
				http.Error(w, "invalid signature", http.StatusUnauthorized)
				return
			}
		} else {
			if hmacSecret == "" && unified {
				http.Error(w, "verification not configured", http.StatusUnauthorized)
				return
			}
			if hmacSecret != "" {
				sig := strings.TrimSpace(r.Header.Get("X-Webhook-Signature"))
				if strings.TrimSpace(r.Header.Get("X-Fystack-Signature")) != "" {
					sig = strings.TrimSpace(r.Header.Get("X-Fystack-Signature"))
				}
				if !verifyHMAC(hmacSecret, body, sig) {
					http.Error(w, "invalid signature", http.StatusUnauthorized)
					return
				}
			}
		}

		if unified {
			resourceID := strings.TrimSpace(str(m["resource_id"]))
			if resourceID == "" {
				resourceID = "unknown"
			}
			dedupe := eventType + ":" + resourceID
			var deliveryID int64
			err = pool.QueryRow(r.Context(), `
				INSERT INTO fystack_webhook_deliveries (dedupe_key, event_type, resource_id, raw)
				VALUES ($1, $2, $3, $4::jsonb)
				ON CONFLICT (dedupe_key) DO NOTHING
				RETURNING id
			`, dedupe, eventType, resourceID, body).Scan(&deliveryID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "duplicate": true})
					return
				}
				http.Error(w, "store failed", http.StatusInternalServerError)
				return
			}
		settled, err := ProcessFystackWebhookDelivery(r.Context(), pool, deliveryID)
		if err != nil {
			log.Printf("fystack webhook: inline processing delivery %d failed: %v", deliveryID, err)
		}
		if settled != nil {
			rawBonus, _ := json.Marshal(settled)
			if err := jobs.Enqueue(r.Context(), rdb, jobs.Job{Type: "bonus_payment_settled", Data: rawBonus}); err != nil {
				if evErr := bonus.EvaluatePaymentSettled(r.Context(), pool, *settled); evErr != nil {
					obs.IncBonusEvalError()
					_, _ = pool.Exec(r.Context(), `
						INSERT INTO worker_failed_jobs (job_type, payload, error_text, attempts)
						VALUES ($1, $2::jsonb, $3, 1)
					`, "bonus_payment_settled", rawBonus, evErr.Error())
				}
			}
		}
		rawID, _ := json.Marshal(map[string]int64{"delivery_id": deliveryID})
		_ = jobs.Enqueue(r.Context(), rdb, jobs.Job{Type: "fystack_webhook", Data: rawID})
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
			return
		}

		// Legacy flat payment shape (fystack_payments table).
		HandleFystackLegacyPayment(r.Context(), w, pool, rdb, m, body)
	}
}

// ProcessFystackWebhookDelivery applies ledger / withdrawal updates for a stored delivery row.
// When a new deposit ledger line is inserted, returns a PaymentSettled fact for BonusHub (idempotent replay returns nil).
func ProcessFystackWebhookDelivery(ctx context.Context, pool *pgxpool.Pool, deliveryID int64) (*bonus.PaymentSettled, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var raw []byte
	var processed bool
	var eventType string
	err = tx.QueryRow(ctx, `
		SELECT raw, processed, event_type FROM fystack_webhook_deliveries WHERE id = $1 FOR UPDATE
	`, deliveryID).Scan(&raw, &processed, &eventType)
	if err != nil {
		return nil, err
	}
	if processed {
		return nil, tx.Commit(ctx)
	}

	var outer map[string]any
	if err := json.Unmarshal(raw, &outer); err != nil {
		return nil, err
	}
	inner, _ := outer["payload"].(map[string]any)
	resourceID := strings.TrimSpace(str(outer["resource_id"]))

	var settled *bonus.PaymentSettled
	switch strings.TrimSpace(eventType) {
	case "deposit.confirmed":
		settled, err = applyFystackDepositConfirmed(ctx, tx, inner, resourceID)
	case "payment.success":
		settled, err = applyFystackPaymentSuccess(ctx, tx, inner, resourceID)
	case "withdrawal.failed":
		err = applyFystackWithdrawalFailed(ctx, tx, inner, resourceID)
	case "withdrawal.confirmed":
		err = applyFystackWithdrawalStatus(ctx, tx, inner, resourceID, "confirmed")
	case "withdrawal.executed":
		err = applyFystackWithdrawalStatus(ctx, tx, inner, resourceID, "executed")
	case "withdrawal.pending":
		err = applyFystackWithdrawalStatus(ctx, tx, inner, resourceID, "pending_approval")
	default:
		err = nil
	}
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `UPDATE fystack_webhook_deliveries SET processed = true WHERE id = $1`, deliveryID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return settled, nil
}

func depositSuccessCountTx(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var n int64
	err := tx.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM ledger_entries
		WHERE user_id = $1::uuid
		  AND entry_type IN ('deposit.credit', 'deposit.checkout')
		  AND amount_minor > 0
	`, userID).Scan(&n)
	return n, err
}

func applyFystackDepositConfirmed(ctx context.Context, tx pgx.Tx, inner map[string]any, resourceID string) (*bonus.PaymentSettled, error) {
	if inner == nil {
		log.Printf("fystack deposit: nil inner payload for resource %s", resourceID)
		return nil, nil
	}
	walletID := strings.TrimSpace(str(inner["wallet_id"]))
	var userID string
	err := tx.QueryRow(ctx, `
		SELECT user_id::text FROM fystack_wallets WHERE provider_wallet_id = $1
	`, walletID).Scan(&userID)
	if err != nil {
		log.Printf("fystack deposit: wallet %s not found: %v", walletID, err)
		return nil, nil
	}
	amt, ok := parseAmountMinor(inner)
	if !ok || amt <= 0 {
		log.Printf("fystack deposit: cannot parse amount for resource %s, amount=%v price_token=%v", resourceID, inner["amount"], inner["price_token"])
		return nil, nil
	}
	ccy := ledgerCurrencyFromAsset(inner)
	idem := "fystack:deposit:" + resourceID
	if resourceID == "" {
		idem = "fystack:deposit:" + strings.TrimSpace(str(inner["id"]))
	}
	provID := resourceID
	if provID == "" {
		provID = strings.TrimSpace(str(inner["id"]))
	}
	meta := map[string]any{"source": "fystack", "wallet_id": walletID, "tx_hash": str(inner["tx_hash"])}
	inserted, err := ledger.ApplyCreditTx(ctx, tx, userID, ccy, "deposit.credit", idem, amt, meta)
	if err != nil {
		log.Printf("fystack deposit: ledger credit failed for user %s: %v", userID, err)
		return nil, err
	}
	log.Printf("fystack deposit: credited %d cents (%s) to user %s (inserted=%v, resource=%s)", amt, ccy, userID, inserted, resourceID)
	if !inserted {
		return nil, nil
	}
	n, err := depositSuccessCountTx(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	return &bonus.PaymentSettled{
		UserID: userID, AmountMinor: amt, Currency: ccy, Channel: "on_chain_deposit",
		ProviderResourceID: provID,
		DepositIndex:       n,
		FirstDeposit:       n == 1,
	}, nil
}

func applyFystackPaymentSuccess(ctx context.Context, tx pgx.Tx, inner map[string]any, resourceID string) (*bonus.PaymentSettled, error) {
	if inner == nil {
		return nil, nil
	}
	uid := strings.TrimSpace(str(inner["customer_id"]))
	if uid == "" {
		uid = strings.TrimSpace(str(inner["user_id"]))
	}
	if uid == "" {
		return nil, nil
	}
	amt, ok := parseUSDCentsFromCheckout(inner)
	if !ok || amt <= 0 {
		amt, ok = parseAmountMinor(inner)
		if !ok || amt <= 0 {
			return nil, nil
		}
	}
	ccy := strings.TrimSpace(str(inner["currency"]))
	if ccy == "" {
		ccy = "USD"
	}
	idem := "fystack:checkout:" + resourceID
	if resourceID == "" {
		idem = "fystack:checkout:" + strings.TrimSpace(str(inner["id"]))
	}
	provID := resourceID
	if provID == "" {
		provID = strings.TrimSpace(str(inner["id"]))
	}
	meta := map[string]any{"source": "fystack_checkout", "checkout_id": str(inner["checkout_id"])}
	inserted, err := ledger.ApplyCreditTx(ctx, tx, uid, ccy, "deposit.checkout", idem, amt, meta)
	if err != nil {
		return nil, err
	}
	if !inserted {
		return nil, nil
	}
	n, err := depositSuccessCountTx(ctx, tx, uid)
	if err != nil {
		return nil, err
	}
	return &bonus.PaymentSettled{
		UserID: uid, AmountMinor: amt, Currency: ccy, Channel: "hosted_checkout",
		ProviderResourceID: provID,
		DepositIndex:       n,
		FirstDeposit:       n == 1,
	}, nil
}

func applyFystackWithdrawalFailed(ctx context.Context, tx pgx.Tx, inner map[string]any, resourceID string) error {
	pid := strings.TrimSpace(str(inner["id"]))
	if pid == "" {
		pid = resourceID
	}
	var wid, userID, ccy string
	var amount int64
	err := tx.QueryRow(ctx, `
		SELECT id, user_id::text, currency, amount_minor FROM fystack_withdrawals
		WHERE provider_withdrawal_id = $1 OR id = $2
		LIMIT 1
	`, pid, pid).Scan(&wid, &userID, &ccy, &amount)
	if err != nil {
		return nil
	}
	_, _ = tx.Exec(ctx, `UPDATE fystack_withdrawals SET status = 'failed' WHERE id = $1`, wid)
	idem := "fystack:wdr_comp:" + pid
	meta := map[string]any{"source": "fystack", "reason": "withdrawal_failed", "withdrawal_id": wid}
	_, err = ledger.ApplyCreditTx(ctx, tx, userID, ccy, "withdrawal.compensation", idem, amount, meta)
	return err
}

func applyFystackWithdrawalStatus(ctx context.Context, tx pgx.Tx, inner map[string]any, resourceID string, status string) error {
	pid := strings.TrimSpace(str(inner["id"]))
	if pid == "" {
		pid = strings.TrimSpace(resourceID)
	}
	if pid == "" {
		return nil
	}
	log.Printf("fystack withdrawal webhook: pid=%s status=%s inner_keys=%v", pid, status, mapKeys(inner))

	txHash := strings.TrimSpace(str(inner["transaction_hash"]))
	if txHash == "" {
		if txn, ok := inner["transaction"].(map[string]any); ok {
			txHash = strings.TrimSpace(str(txn["hash"]))
			if txHash == "" {
				txHash = strings.TrimSpace(str(txn["transaction_hash"]))
			}
		}
	}

	if txHash != "" {
		rawPatch, _ := json.Marshal(map[string]any{"tx_hash": txHash})
		_, err := tx.Exec(ctx, `
			UPDATE fystack_withdrawals SET status = $2, raw = COALESCE(raw, '{}'::jsonb) || $3::jsonb
			WHERE provider_withdrawal_id = $1 OR id = $1
		`, pid, status, rawPatch)
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE fystack_withdrawals SET status = $2
		WHERE provider_withdrawal_id = $1 OR id = $1
	`, pid, status)
	return err
}

func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func parseAmountMinor(inner map[string]any) (int64, bool) {
	s := strings.TrimSpace(str(inner["amount"]))
	if s == "" {
		return 0, false
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil && n > 0 {
		return n, true
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f <= 0 {
		return 0, false
	}

	// Compute USD value: amount * price_token, or explicit usd_value/fiat_value fields.
	usdVal := 0.0
	if v := strings.TrimSpace(str(inner["usd_value"])); v != "" {
		if uv, err := strconv.ParseFloat(v, 64); err == nil && uv > 0 {
			usdVal = uv
		}
	}
	if usdVal <= 0 {
		if v := strings.TrimSpace(str(inner["fiat_value"])); v != "" {
			if fv, err := strconv.ParseFloat(v, 64); err == nil && fv > 0 {
				usdVal = fv
			}
		}
	}
	if usdVal <= 0 {
		if pt := strings.TrimSpace(str(inner["price_token"])); pt != "" {
			if pf, err := strconv.ParseFloat(pt, 64); err == nil && pf > 0 {
				usdVal = f * pf
			}
		}
	}
	if usdVal <= 0 {
		if pt := strings.TrimSpace(str(inner["price_native_token"])); pt != "" {
			if pf, err := strconv.ParseFloat(pt, 64); err == nil && pf > 0 {
				usdVal = f * pf
			}
		}
	}
	if usdVal <= 0 {
		usdVal = f
	}

	cents := int64(usdVal*100 + 0.5)
	if cents <= 0 {
		return 0, false
	}
	return cents, true
}

// HandleFystackLegacyPayment stores flat payment-shaped webhooks and enqueues fystack_payment jobs.
func HandleFystackLegacyPayment(ctx context.Context, w http.ResponseWriter, pool *pgxpool.Pool, rdb *redis.Client, m map[string]any, body []byte) {
	payID := strings.TrimSpace(str(m["id"]))
	if payID == "" {
		payID = strings.TrimSpace(str(m["payment_id"]))
	}
	if payID == "" {
		payID = "fs-unknown"
	}
	status := strings.TrimSpace(str(m["status"]))
	if status == "" {
		status = "received"
	}
	var uid any
	if u := strings.TrimSpace(str(m["user_id"])); u != "" {
		uid = u
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO fystack_payments (id, user_id, status, idempotency_key, raw)
		VALUES ($1, $2::uuid, $3, $4, $5::jsonb)
		ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw = EXCLUDED.raw
	`, payID, uid, status, "fystack:pay:"+payID, body)
	if err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	rawID, _ := json.Marshal(map[string]string{"id": payID})
	if err := jobs.Enqueue(ctx, rdb, jobs.Job{Type: "fystack_payment", Data: rawID}); err != nil {
		_ = ProcessFystackPayment(ctx, pool, payID)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func parseUSDCentsFromCheckout(inner map[string]any) (int64, bool) {
	price := strings.TrimSpace(str(inner["price"]))
	if price == "" {
		if oc, ok := inner["outcome"].(map[string]any); ok {
			price = strings.TrimSpace(str(oc["price"]))
		}
	}
	if price == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(price, 64)
	if err != nil {
		return 0, false
	}
	return int64(f*100 + 0.5), true
}

func ledgerCurrencyFromAsset(inner map[string]any) string {
	if a, ok := inner["asset"].(map[string]any); ok {
		if s := strings.TrimSpace(str(a["symbol"])); s != "" {
			return strings.ToUpper(s)
		}
	}
	return "USD"
}
