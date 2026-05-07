package webhooks

// PassimPay withdrawal callback handler (P3).
//
// PassimPay POSTs `type=withdraw` callbacks to the notification URL configured
// in the platform (same URL as deposits — distinguished by the `type` field).
// Per docs (https://passimpay.gitbook.io/passimpay-api/webhook-1):
//
//   approve = 0  →  wait    (in flight, no terminal action)
//   approve = 1  →  success (on-chain confirmed; mark COMPLETED + tx_hash)
//   approve = 2  →  error   (terminal fail; refund the user)
//
// Idempotency:
//   - The whole callback is deduplicated by (provider, callback_type, provider_event_id)
//     in the `processed_callbacks` table — provider_event_id = orderId+":"+txhash
//     when txhash is set, falling back to orderId+":"+approve+":"+bodyDigest.
//   - Per-state ledger writes use deterministic idempotency keys derived from
//     the orderId, so a re-delivery cannot double-credit.
//   - For a TERMINAL FAILED webhook the cash refund + clearing reverse pair is
//     keyed by orderId, so even if PassimPay re-sends the same approve=2 a
//     dozen times the user cash and house clearing remain at the right total.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func handlePassimpayWithdrawalCallback(
	r *http.Request,
	pool *pgxpool.Pool,
	cfg *config.Config,
	w http.ResponseWriter,
	raw []byte,
	m map[string]any,
	bodyDigest string,
	sigOK bool,
) {
	ctx := r.Context()

	orderID := strClean(m["orderId"])
	if orderID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":false,"reason":"missing_order_id"}`))
		return
	}

	txhash := strings.TrimSpace(fmt.Sprint(m["txhash"]))
	approveCode := intFromAny(m["approve"])

	// Per-callback dedup key. Use approve in the key so the wait→success state
	// transition is each its own event (PassimPay can deliver more than one
	// callback per withdrawal — wait, then success).
	dedupID := orderID + ":" + fmt.Sprintf("%d", approveCode) + ":" + txhash
	if txhash == "" {
		dedupID = orderID + ":" + fmt.Sprintf("%d", approveCode) + ":body:" + bodyDigest
	}

	tag, err := pool.Exec(ctx, `
		INSERT INTO processed_callbacks (provider, callback_type, provider_event_id, request_hash, status)
		VALUES ('passimpay', 'withdraw', $1, $2, 'RECEIVED')
		ON CONFLICT (provider, callback_type, provider_event_id) DO NOTHING
	`, dedupID, bodyDigest)
	if err != nil {
		log.Printf("passimpay withdraw webhook: processed_callbacks insert: %v", err)
	}
	if err == nil && tag.RowsAffected() == 0 {
		// Already processed — return 200 idempotently.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true,"duplicate":true}`))
		return
	}

	var (
		userID      string
		ccy         string
		amountMinor int64
		status      string
		idemSuffix  string
	)
	row := pool.QueryRow(ctx, `
		SELECT user_id::text, COALESCE(currency,''), amount_minor, status, COALESCE(ledger_lock_idem_suffix,'')
		FROM payment_withdrawals
		WHERE provider = 'passimpay' AND provider_order_id = $1
		LIMIT 1
	`, orderID)
	if scanErr := row.Scan(&userID, &ccy, &amountMinor, &status, &idemSuffix); scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			log.Printf("passimpay withdraw webhook: orphan orderId=%s", orderID)
			markProcessed(ctx, pool, dedupID, "ORPHAN", raw)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true,"note":"withdrawal_not_found"}`))
			return
		}
		log.Printf("passimpay withdraw webhook: lookup err=%v", scanErr)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	confirmations := intFromAny(m["confirmations"])
	providerTxID := strClean(m["transactionId"])

	switch approveCode {
	case 1:
		// SUCCESS — funds confirmed on-chain. Update the row to COMPLETED, store
		// tx_hash + confirmations. The ledger was already settled at submission
		// time; nothing to write here unless the row was stuck in
		// LEDGER_SETTLE_FAILED (a P6 retry case) — in which case we attempt the
		// settle again. Idempotent.
		if !isWithdrawalAlreadyTerminal(status) {
			updateWithdrawalToCompleted(ctx, pool, orderID, txhash, providerTxID, confirmations)
		} else {
			log.Printf("passimpay withdraw webhook: COMPLETED arrived for already-terminal status=%s order=%s", status, orderID)
		}
		// If the row was stuck in LEDGER_SETTLE_FAILED, drive the settle now —
		// PassimPay just confirmed funds left the platform, so withholding the
		// clearing entry would understate house liability. finalize is idempotent.
		if status == "LEDGER_SETTLE_FAILED" {
			retryFinalizeAfterSettle(ctx, pool, cfg, userID, ccy, amountMinor, idemSuffix, orderID)
		}
		// Provider fee on the withdrawal leg (E-6). PassimPay reports the
		// outbound network fee on the success callback. Recording it as a
		// `provider.fee` debit on the house user lets analytics deduct it
		// from NGR even though it never touched the player's wallet. The
		// idempotency key is per-withdrawal so duplicate success callbacks
		// don't double-charge.
		if feeMinor := extractPassimpayWithdrawalFeeMinor(ctx, pool, m, ccy); feeMinor > 0 {
			feeIdem := fmt.Sprintf("passimpay:withdrawal:fee:%s", orderID)
			if _, fErr := ledger.RecordProviderFee(ctx, pool, ledger.HouseUserID(cfg),
				ccy, "passimpay", feeIdem, feeMinor, map[string]any{
					"order_id":   orderID,
					"tx_hash":    txhash,
					"direction":  "withdrawal",
				}); fErr != nil {
				log.Printf("passimpay withdraw webhook: provider fee: %v", fErr)
			}
		}
		markProcessed(ctx, pool, dedupID, "OK", raw)

	case 2:
		// TERMINAL FAIL — provider could not pay. Refund cash to the user (we
		// already debited cash + posted clearing at submission). Compensate by
		// crediting cash and reversing the clearing outbound. New entry types
		// keep this distinguishable from the normal pre-submit unlock path.
		if isWithdrawalAlreadyTerminal(status) {
			log.Printf("passimpay withdraw webhook: FAIL arrived for already-terminal status=%s order=%s", status, orderID)
			markProcessed(ctx, pool, dedupID, "DUP_TERMINAL", raw)
			break
		}
		failureReason := strClean(m["message"])
		if failureReason == "" {
			failureReason = "passimpay_withdraw_failed"
		}
		if err := compensateAfterTerminalFail(ctx, pool, cfg, userID, ccy, amountMinor, orderID); err != nil {
			log.Printf("passimpay withdraw webhook: compensation failed order=%s: %v", orderID, err)
			insertReconciliationAlertCore(ctx, pool, "withdrawal_terminal_fail_compensation_failed", userID, "payment_withdrawals", orderID, map[string]any{
				"amount_minor": amountMinor, "currency": ccy, "err": err.Error(),
			})
			http.Error(w, "compensation_failed", http.StatusInternalServerError)
			return
		}
		_, _ = pool.Exec(ctx, `
			UPDATE payment_withdrawals SET
				status = 'FAILED_BY_PROVIDER',
				tx_hash = NULLIF($2,''),
				confirmations = $3,
				failure_reason = $4,
				metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('provider_terminal_fail', true),
				updated_at = now()
			WHERE provider = 'passimpay' AND provider_order_id = $1
		`, orderID, txhash, confirmations, failureReason)
		markProcessed(ctx, pool, dedupID, "COMPENSATED", raw)

	default:
		// approve == 0 (wait) or unknown — store progress info, no terminal action.
		_, _ = pool.Exec(ctx, `
			UPDATE payment_withdrawals SET
				tx_hash = COALESCE(NULLIF($2,''), tx_hash),
				confirmations = COALESCE($3, confirmations),
				updated_at = now()
			WHERE provider = 'passimpay' AND provider_order_id = $1
		`, orderID, txhash, confirmations)
		markProcessed(ctx, pool, dedupID, "WAIT", raw)
	}

	if !sigOK {
		log.Printf("passimpay withdraw webhook: WARN invalid signature processed (env not fail-closed) order=%s", orderID)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func updateWithdrawalToCompleted(ctx context.Context, pool *pgxpool.Pool, orderID, txhash, providerTxID string, confirmations int) {
	_, err := pool.Exec(ctx, `
		UPDATE payment_withdrawals SET
			status = 'COMPLETED',
			tx_hash = COALESCE(NULLIF($2,''), tx_hash),
			confirmations = $3,
			provider_transaction_id = COALESCE(provider_transaction_id, NULLIF($4,'')),
			updated_at = now()
		WHERE provider = 'passimpay' AND provider_order_id = $1
		  AND status NOT IN ('COMPLETED','FAILED','FAILED_BY_PROVIDER','REJECTED_BY_ADMIN')
	`, orderID, txhash, confirmations, providerTxID)
	if err != nil {
		log.Printf("passimpay withdraw webhook: update COMPLETED order=%s: %v", orderID, err)
	}
}

func isWithdrawalAlreadyTerminal(status string) bool {
	switch status {
	case "COMPLETED", "FAILED", "FAILED_BY_PROVIDER", "REJECTED_BY_ADMIN":
		return true
	}
	return false
}

// compensateAfterTerminalFail refunds the user and reverses the clearing entry
// when a withdrawal that was already settled in our ledger (cash debited,
// clearing.outbound credited on the house user) is reported as terminal-failed
// by PassimPay. Idempotent — keys are deterministic from the order id.
func compensateAfterTerminalFail(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, userID, ccy string, amountMinor int64, orderID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	keyCash := fmt.Sprintf("passimpay:wdr:terminal_fail:cash:%s", orderID)
	keyClearing := fmt.Sprintf("passimpay:wdr:terminal_fail:clearing:%s", orderID)
	meta := map[string]any{
		"provider_order_id": orderID,
		"compensation":      "terminal_fail_after_settle",
	}

	if _, err := ledger.ApplyCreditTx(ctx, tx, userID, strings.ToUpper(ccy), ledger.EntryTypeWithdrawalCompensationCashAfterSettle, keyCash, amountMinor, meta); err != nil {
		return fmt.Errorf("credit user cash: %w", err)
	}
	if _, err := ledger.ApplyCreditWithPocketTx(ctx, tx, ledger.HouseUserID(cfg), strings.ToUpper(ccy), ledger.EntryTypeWithdrawalCompensationClearingOut, keyClearing, -amountMinor, ledger.PocketClearingWithdrawalOut, meta); err != nil {
		return fmt.Errorf("debit clearing: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// retryFinalizeAfterSettle is a best-effort settle for rows stuck in
// LEDGER_SETTLE_FAILED at the moment a success webhook arrives. The dedicated
// P6 worker is the primary recovery path; this is just an opportunistic retry.
func retryFinalizeAfterSettle(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, userID, ccy string, amountMinor int64, idemSuffix, orderID string) {
	pendingKey := fmt.Sprintf("passimpay:wdr:finalize:pending:webhook:%s", orderID)
	meta := map[string]any{"provider_order_id": orderID, "via": "webhook_retry"}
	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Printf("passimpay withdraw webhook: retryFinalize begin order=%s: %v", orderID, err)
		return
	}
	defer tx.Rollback(ctx)
	if _, err := ledger.ApplyDebitTxWithPocket(ctx, tx, userID, strings.ToUpper(ccy), ledger.EntryTypeWithdrawalPendingSettled, pendingKey, amountMinor, ledger.PocketPendingWithdrawal, meta); err != nil {
		log.Printf("passimpay withdraw webhook: retryFinalize pending order=%s: %v", orderID, err)
		return
	}
	if _, err := ledger.PostWithdrawalOutboundClearingTx(ctx, tx, ledger.HouseUserID(cfg), strings.ToUpper(ccy), amountMinor, orderID, meta); err != nil {
		log.Printf("passimpay withdraw webhook: retryFinalize clearing order=%s: %v", orderID, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		log.Printf("passimpay withdraw webhook: retryFinalize commit order=%s: %v", orderID, err)
		return
	}
	_, _ = pool.Exec(ctx, `
		UPDATE payment_withdrawals SET status = 'COMPLETED', updated_at = now()
		WHERE provider = 'passimpay' AND provider_order_id = $1 AND status = 'LEDGER_SETTLE_FAILED'
	`, orderID)
}

func markProcessed(ctx context.Context, pool *pgxpool.Pool, eventID, status string, raw []byte) {
	_, err := pool.Exec(ctx, `
		UPDATE processed_callbacks SET status = $2, processed_at = now(), response_body = $3::jsonb
		WHERE provider = 'passimpay' AND callback_type = 'withdraw' AND provider_event_id = $1
	`, eventID, status, json.RawMessage(raw))
	if err != nil {
		log.Printf("passimpay withdraw webhook: mark processed: %v", err)
	}
}

// extractPassimpayWithdrawalFeeMinor returns the network/platform fee
// reported on a successful withdrawal callback in the same minor-unit
// precision as the withdrawal currency. Returns 0 when no fee field is
// present or it is unparseable. We resolve the decimals via the currency's
// payment_currencies row so this works for any of the >50 chains PassimPay
// supports without hard-coding token decimals.
func extractPassimpayWithdrawalFeeMinor(ctx context.Context, pool *pgxpool.Pool, m map[string]any, currency string) int64 {
	decimals := decimalsForSymbol(ctx, pool, currency)
	for _, key := range []string{"commission", "fee", "fee_amount", "feeAmount", "providerCommission", "networkFee"} {
		raw := strings.TrimSpace(fmt.Sprint(m[key]))
		if raw == "" || raw == "<nil>" || raw == "0" {
			continue
		}
		minor, err := decimalStringToMinor(raw, decimals)
		if err == nil && minor > 0 {
			return minor
		}
	}
	return 0
}

// decimalsForSymbol looks up the canonical decimals for a currency symbol
// (USDT, BTC, ETH, etc.) by joining payment_currencies. Falls back to 8
// for unknown symbols (matches Bitcoin convention) so we never return 0,
// which would force fee strings to round to integer satoshis.
func decimalsForSymbol(ctx context.Context, pool *pgxpool.Pool, sym string) int {
	if pool == nil {
		return 8
	}
	sym = strings.ToUpper(strings.TrimSpace(sym))
	if sym == "" {
		return 8
	}
	var d int
	if err := pool.QueryRow(ctx, `
		SELECT decimals FROM payment_currencies
		WHERE provider = 'passimpay' AND UPPER(symbol) = $1
		ORDER BY id ASC LIMIT 1
	`, sym).Scan(&d); err != nil {
		return 8
	}
	if d <= 0 {
		return 8
	}
	return d
}

// insertReconciliationAlertCore is a best-effort writer for high-priority
// operational invariants — e.g. ledger compensation failed during a terminal
// withdrawal webhook. Logs but never returns an error to the caller; the
// HTTP path has already taken its primary action.
func insertReconciliationAlertCore(ctx context.Context, pool *pgxpool.Pool, kind, userID, refType, refID string, details map[string]any) {
	detailsBytes, _ := json.Marshal(details)
	if _, err := pool.Exec(ctx, `
		INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
	`, kind, userID, refType, refID, detailsBytes); err != nil {
		slog.ErrorContext(ctx, "reconciliation_alert_insert_failed", "kind", kind, "ref_id", refID, "err", err)
	}
}
