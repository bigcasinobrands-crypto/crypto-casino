package wallet

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/compliance"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/cryptokit"
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/market"
	"github.com/crypto-casino/core/internal/payments/passimpay"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/playernotify"
	"github.com/crypto-casino/core/internal/reconcile"
	"github.com/crypto-casino/core/internal/riskassessment"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type passimpayWithdrawReq struct {
	withdrawReq
	PaymentID int `json:"payment_id"`
}

func withdrawalPassimpay(
	w http.ResponseWriter,
	r *http.Request,
	pool *pgxpool.Pool,
	cfg *config.Config,
	tickers *market.CryptoTickers,
	fp *fingerprint.Client,
	sender mail.Sender,
) {
	if cfg == nil || !cfg.PassimPayConfigured() {
		playerapi.WriteError(w, http.StatusServiceUnavailable, "passimpay_unconfigured", "PassimPay withdrawals are not configured")
		return
	}
	if !cfg.PassimpayWithdrawalsEnabled {
		playerapi.WriteError(w, http.StatusForbidden, "passimpay_withdrawals_disabled", "PassimPay withdrawals are disabled (set PASSIMPAY_WITHDRAWALS_ENABLED=true)")
		return
	}
	uid, ok := playerapi.UserIDFromContext(r.Context())
	if !ok {
		playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	flags, err := paymentflags.Load(r.Context(), pool)
	if err == nil && !flags.WithdrawalsEnabled {
		playerapi.WriteError(w, http.StatusForbidden, "withdrawals_disabled", "withdrawals are temporarily unavailable")
		return
	}
	// Cooling-off RG check: blocks withdrawals while a self-imposed (or
	// admin-imposed) cooling-off window is active. Returning 403 surfaces a
	// distinct error code so the wallet UI can show a clear "your account is
	// in cooling-off until X" banner instead of a generic failure.
	if rgErr := compliance.CheckWithdrawalAllowed(r.Context(), pool, uid); rgErr != nil {
		playerapi.WriteError(w, http.StatusForbidden, "rg_cooling_off", rgErr.Error())
		return
	}
	var body passimpayWithdrawReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	if body.PaymentID < 1 {
		playerapi.WriteError(w, http.StatusBadRequest, "payment_id_required", "payment_id (PassimPay currency id) is required")
		return
	}
	if body.AmountMinor < 1 || strings.TrimSpace(body.Destination) == "" {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "amount and destination required")
		return
	}
	if (cfg.WithdrawRequireFingerprint || cfg.PlayerFingerprintAuthRequired()) && strings.TrimSpace(body.FingerprintRequestID) == "" {
		playerapi.WriteError(w, http.StatusBadRequest, "fingerprint_required", "fingerprint_request_id required for withdrawals")
		return
	}
	ccy := strings.ToUpper(strings.TrimSpace(body.Currency))
	if ccy == "" {
		ccy = "USDT"
	}
	network := config.NormalizeDepositNetwork(body.Network)
	if network == "" {
		network = "ERC20"
	}

	// P9: validate (payment_id, symbol, network) against payment_currencies and
	// reject when the currency is unknown or has withdrawals disabled.
	curr, cerr := loadPassimpayCurrency(r.Context(), pool, body.PaymentID, ccy, network)
	if cerr != nil {
		if errors.Is(cerr, pgx.ErrNoRows) {
			playerapi.WriteError(w, http.StatusBadRequest, "unsupported_currency", "no payment_currencies row for this provider/payment_id/symbol/network")
			return
		}
		log.Printf("passimpay withdraw: payment_currencies lookup err=%v", cerr)
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "currency lookup failed")
		return
	}
	if !curr.WithdrawEnabled {
		playerapi.WriteError(w, http.StatusForbidden, "withdraw_disabled", "withdrawals are disabled for this currency")
		return
	}
	// P7: enforce server-side minimum withdrawal.
	if curr.MinWithdrawMinor != nil && body.AmountMinor < *curr.MinWithdrawMinor {
		playerapi.WriteError(w, http.StatusBadRequest, "below_min_withdraw", fmt.Sprintf("minimum withdrawal is %d minor units", *curr.MinWithdrawMinor))
		return
	}
	// SEC-4: address format validation per network. Catches typos before
	// anything ledger-locks or hits the provider.
	if reason := ValidateWithdrawalAddress(network, body.Destination); reason != "" {
		playerapi.WriteError(w, http.StatusBadRequest, "invalid_address", "destination address looks invalid for "+network+" ("+reason+")")
		return
	}

	// KYC gate (E-4): block withdrawals over the configured USD threshold
	// unless `users.kyc_status='approved'`. body.AmountMinor is already in
	// USD cents (the canonical wallet unit), so we can pass it through to
	// CheckKYCForLargeWithdrawal directly. Disabled when threshold <= 0.
	if kycErr := compliance.CheckKYCForLargeWithdrawal(r.Context(), pool, uid, body.AmountMinor, cfg.KYCLargeWithdrawalThresholdCents); kycErr != nil {
		playerapi.WriteError(w, http.StatusForbidden, "kyc_required", kycErr.Error())
		return
	}

	if blocked, msg, err := bonus.WithdrawPolicyBlock(r.Context(), pool, uid); err == nil && blocked {
		playerapi.WriteError(w, http.StatusForbidden, "bonus_blocks_withdraw", msg)
		return
	}

	fc := RunFraudChecks(r.Context(), pool, cfg, uid, body.AmountMinor)
	if !fc.Allowed {
		log.Printf("fraud check blocked passimpay withdrawal: user=%s amount=%d reason=%s", uid, body.AmountMinor, fc.Reason)
		playerapi.WriteError(w, http.StatusForbidden, "fraud_check_failed", fc.Reason)
		return
	}

	idem := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idem == "" {
		idem = uuid.NewString()
	}

	var existingWid, existingStatus string
	err = pool.QueryRow(r.Context(), `
		SELECT withdrawal_id::text, status FROM payment_withdrawals WHERE provider = 'passimpay' AND ledger_lock_idem_suffix = $1
	`, idem).Scan(&existingWid, &existingStatus)
	if err == nil && existingWid != "" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"withdrawal_id": existingWid,
			"status":        existingStatus,
			"amount_minor":  body.AmountMinor,
			"currency":      ccy,
			"idempotent":    true,
		})
		return
	}

	pid := uuid.New()

	txn, err := pool.Begin(r.Context())
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "tx begin failed")
		return
	}
	defer txn.Rollback(r.Context())

	if _, err := txn.Exec(r.Context(), `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, uid); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "user lock failed")
		return
	}
	cashBal, err := ledger.BalanceCashTx(r.Context(), txn, uid)
	if err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "balance failed")
		return
	}
	if cashBal < body.AmountMinor {
		playerapi.WriteError(w, http.StatusBadRequest, "insufficient_balance", "not enough withdrawable cash balance")
		return
	}

	meta := map[string]any{
		"destination":      body.Destination,
		"withdrawal_local": pid.String(),
		"payment_provider": "passimpay",
		"payment_id":       body.PaymentID,
	}
	rawFP := mergeWithdrawFingerprintMeta(r.Context(), meta, cfg, fp, strings.TrimSpace(body.FingerprintRequestID))
	if err := fingerprint.MergeTrafficAttributionTx(r.Context(), txn, uid, time.Now().UTC(), meta); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "attribution merge failed")
		return
	}

	lockCashKey := fmt.Sprintf("passimpay:wdr:lock:cash:%s:%s", pid.String(), idem)
	lockPendingKey := fmt.Sprintf("passimpay:wdr:lock:pending:%s:%s", pid.String(), idem)

	if _, err := ledger.ApplyDebitTx(r.Context(), txn, uid, ccy, "withdrawal.lock.cash", lockCashKey, body.AmountMinor, meta); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "ledger lock cash failed")
		return
	}
	if _, err := ledger.ApplyCreditWithPocketTx(r.Context(), txn, uid, ccy, "withdrawal.lock.pending", lockPendingKey, body.AmountMinor, ledger.PocketPendingWithdrawal, meta); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "ledger lock pending failed")
		return
	}

	payIDDigits := strconv.Itoa(body.PaymentID)

	// SEC-7: encrypt the destination address at rest. We store the AES-GCM
	// blob in destination_address_encrypted, a sha256 of the normalized
	// address in destination_address_hash (sanctions-list match without
	// decrypt), and the last 4 chars in destination_address_last4 (safe
	// for UI display). The legacy destination_address column stays
	// populated until a follow-up migration nulls it out — keeping it
	// here lets old UIs and reports continue to function while the
	// encrypted column rolls forward.
	addrCipher, addrCipherErr := newAddressCipher(cfg)
	var addrCT []byte
	if addrCipher != nil {
		var encErr error
		addrCT, encErr = addrCipher.Encrypt(body.Destination)
		if encErr != nil {
			log.Printf("passimpay withdraw: address encrypt: %v", encErr)
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "address encryption failed")
			return
		}
	} else if addrCipherErr != nil && addrCipherErr.Error() != "" {
		// Cipher missing in production should fail closed; in dev the
		// caller may run without the KEK so we proceed with plaintext only.
		log.Printf("passimpay withdraw: cipher init: %v (proceeding without encryption)", addrCipherErr)
	}
	addrHash := cryptokitHashAddress(body.Destination)
	addrLast4 := cryptokitLast4(body.Destination)

	_, err = txn.Exec(r.Context(), `
		INSERT INTO payment_withdrawals (
			id, withdrawal_id, user_id, provider, provider_order_id, provider_payment_id,
			currency, network, amount_minor, destination_address,
			destination_address_encrypted, destination_address_hash, destination_address_last4,
			status, ledger_lock_idem_suffix
		) VALUES (
			$1::uuid, $1::uuid, $2::uuid, 'passimpay', $3, $4,
			$5, $6, $7, $8,
			$9, NULLIF($10,''), NULLIF($11,''),
			'LEDGER_LOCKED', $12
		)
	`, pid.String(), uid, idem, payIDDigits, ccy, network, body.AmountMinor, body.Destination,
		addrCT, addrHash, addrLast4, idem)
	if err != nil {
		log.Printf("payment_withdrawals insert: %v", err)
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "withdrawal row failed")
		return
	}
	if err := txn.Commit(r.Context()); err != nil {
		playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "commit failed")
		return
	}

	if rawFP != nil {
		vid, _ := meta["visitor_id"].(string)
		if err := riskassessment.InsertFromEvent(r.Context(), pool, uid, "withdrawal_request_passimpay",
			strings.TrimSpace(body.FingerprintRequestID), strings.TrimSpace(vid), rawFP, meta); err != nil {
			log.Printf("risk_assessments insert: %v", err)
		}
	}
	if err := reconcile.MaybeInsertGeoTrafficMismatch(r.Context(), pool, uid, "withdrawal", pid.String(), meta); err != nil {
		log.Printf("reconciliation_alerts insert: %v", err)
	}

	// AML monitoring (E-3): record reconciliation_alerts on withdrawal
	// patterns that warrant manual review. These are non-blocking — the
	// withdrawal still proceeds — they just give the operator a queue to
	// triage. body.AmountMinor is USD cents.
	compliance.EmitAMLLargeWithdrawalAlert(r.Context(), pool, uid, ccy, pid.String(), body.AmountMinor, cfg.AMLLargeWithdrawalAlertThresholdCents)
	compliance.EmitAMLRapidWithdrawalAlert(r.Context(), pool, uid, pid.String(), 24)

	amtStr, convErr := centsToTokenAmount(ccy, body.AmountMinor, tickers)
	if convErr != nil {
		log.Printf("passimpay withdraw: price conversion failed for %s: %v", ccy, convErr)
		passimpayUnlockFunds(r.Context(), pool, uid, ccy, body.AmountMinor, idem, pid.String())
		playerapi.WriteError(w, http.StatusBadGateway, "price_unavailable", "cannot derive token amount for "+ccy+"; funds were unlocked")
		return
	}

	// Operator daily payout cap (E-10). Treasury-drain protection: if the
	// platform has already settled the configured cap of withdrawals in the
	// last rolling 24h, hold this row in PENDING_REVIEW instead of
	// submitting to PassimPay. The funds stay LEDGER_LOCKED so the player's
	// balance is correct; an operator can approve from the admin queue (or
	// the row will be picked up automatically once the rolling window
	// drops below the cap).
	if cfg.OperatorDailyPayoutCapCents > 0 {
		allowed, spent, budget, capErr := CheckOperatorDailyPayoutBudget(r.Context(), pool, body.AmountMinor, cfg.OperatorDailyPayoutCapCents)
		if capErr != nil {
			log.Printf("operator payout budget check err: %v", capErr)
			// Fail closed: treat budget-check failure the same as exhausted
			// budget. We keep the lock but mark for review.
			allowed = false
			spent = 0
			budget = cfg.OperatorDailyPayoutCapCents
		}
		if !allowed {
			_, _ = pool.Exec(r.Context(), `
				UPDATE payment_withdrawals
				SET status = 'PENDING_REVIEW',
				    failure_reason = $2,
				    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('treasury_held_at', now(), 'spent_24h_cents', $3::bigint, 'budget_cents', $4::bigint),
				    updated_at = now()
				WHERE provider = 'passimpay' AND provider_order_id = $1
			`, idem, "operator_daily_payout_cap_exceeded", spent, budget)
			details := map[string]any{
				"withdrawal_id":   pid.String(),
				"amount_cents":    body.AmountMinor,
				"spent_24h_cents": spent,
				"budget_cents":    budget,
			}
			detailsBytes, _ := json.Marshal(details)
			if _, aerr := pool.Exec(r.Context(), `
				INSERT INTO reconciliation_alerts (kind, user_id, reference_type, reference_id, details)
				VALUES ('treasury_daily_cap_held', $1::uuid, 'payment_withdrawal', $2, COALESCE($3::jsonb,'{}'::jsonb))
			`, uid, pid.String(), detailsBytes); aerr != nil {
				log.Printf("treasury cap alert: %v", aerr)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withdrawal_id":   pid.String(),
				"status":          "PENDING_REVIEW",
				"amount_minor":    body.AmountMinor,
				"currency":        ccy,
				"held_for_review": "operator_daily_payout_cap_exceeded",
			})
			playernotify.WithdrawalSubmitted(pool, sender, cfg, uid, pid.String(), ccy, body.AmountMinor, "Pending operator review — daily payout volume limit")
			return
		}
	}

	timeout := time.Duration(cfg.PassimpayRequestTimeoutMs) * time.Millisecond
	client := passimpay.NewClient(cfg.PassimpayAPIBaseURL, cfg.PassimpayPlatformID, cfg.PassimpaySecretKey, timeout)
	ctx2, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	txProv, err := client.CreateWithdraw(ctx2, body.PaymentID, body.Destination, amtStr, idem)
	if err != nil || strings.TrimSpace(txProv) == "" {
		msg := ""
		if err != nil {
			msg = truncateForDB(err.Error(), 480)
		}
		log.Printf("passimpay withdraw API fail user=%s idem=%s: %v resp=%q", uid, idem, err, txProv)
		passimpayUnlockFunds(r.Context(), pool, uid, ccy, body.AmountMinor, idem, pid.String())
		_, _ = pool.Exec(r.Context(), `UPDATE payment_withdrawals SET status = 'FAILED', failure_reason = $2 WHERE provider_order_id = $1`, idem, msg)
		playerapi.WriteError(w, http.StatusBadGateway, "provider_error", "Withdrawal could not be submitted to PassimPay; funds were unlocked")
		return
	}

	finalPendingKey := fmt.Sprintf("passimpay:wdr:finalize:pending:%s:%s", pid.String(), idem)
	metaFin := map[string]any{
		"provider_transaction_id": txProv,
		"provider_order_id":       idem,
	}
	if ferr := finalizePassimpayWithdrawLedgerWithRetry(r.Context(), pool, cfg, uid, ccy, body.AmountMinor, finalPendingKey, idem, metaFin); ferr != nil {
		log.Printf("passimpay finalize ledger failed after retries user=%s idem=%s: %v", uid, idem, ferr)
		msg := truncateForDB(ferr.Error(), 480)
		_, _ = pool.Exec(r.Context(), `
			UPDATE payment_withdrawals SET provider_transaction_id = $2, status = 'LEDGER_SETTLE_FAILED', failure_reason = $3, updated_at = now()
			WHERE provider_order_id = $1`, idem, txProv, msg)
		playerapi.WriteError(w, http.StatusInternalServerError, "ledger_settle_failed", "Withdrawal was accepted by the payment provider but internal ledger settlement failed — contact support with your withdrawal id")
		return
	}

	_, _ = pool.Exec(r.Context(), `
		UPDATE payment_withdrawals SET provider_transaction_id = $2, status = 'SUBMITTED_TO_PROVIDER', updated_at = now()
		WHERE provider_order_id = $1`, idem, txProv)

	playernotify.WithdrawalSentToProvider(pool, sender, cfg, uid, pid.String(), ccy, body.AmountMinor)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"withdrawal_id":           pid.String(),
		"provider_transaction_id": txProv,
		"status":                  "SUBMITTED_TO_PROVIDER",
		"amount_minor":            body.AmountMinor,
		"currency":                ccy,
	})
}

// finalizePassimpayWithdrawLedgerWithRetry settles pending_withdrawal -> house clearing; transient DB errors are retried because the provider payout may already be in flight.
func finalizePassimpayWithdrawLedgerWithRetry(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, userID, ccy string, amountMinor int64, pendingIdemKey, providerOrderID string, meta map[string]any) error {
	backoffs := []time.Duration{0, 50 * time.Millisecond, 200 * time.Millisecond, 500 * time.Millisecond}
	var lastErr error
	for i, d := range backoffs {
		if d > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(d):
			}
		}
		_, err := finalizePassimpayWithdrawLedger(ctx, pool, cfg, userID, ccy, amountMinor, pendingIdemKey, providerOrderID, meta)
		if err == nil {
			return nil
		}
		lastErr = err
		log.Printf("passimpay finalize attempt %d: %v", i+1, err)
	}
	return lastErr
}

func finalizePassimpayWithdrawLedger(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, userID, ccy string, amountMinor int64, pendingIdemKey, providerOrderID string, meta map[string]any) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	ins, err := ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "withdrawal.pending.settled", pendingIdemKey, amountMinor, ledger.PocketPendingWithdrawal, meta)
	if err != nil {
		return false, err
	}
	if _, err := ledger.PostWithdrawalOutboundClearingTx(ctx, tx, ledger.HouseUserID(cfg), ccy, amountMinor, providerOrderID, meta); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return ins, nil
}

// passimpayUnlockFunds reverses lock (cash restore + pending pocket zero) after provider failure or conversion error.
func passimpayUnlockFunds(ctx context.Context, pool *pgxpool.Pool, userID, ccy string, amountMinor int64, idem, wid string) {
	if err := PassimpayUnlockFundsErr(ctx, pool, userID, ccy, amountMinor, idem, wid); err != nil {
		log.Printf("passimpay unlock failed (idem=%s wid=%s): %v", idem, wid, err)
	}
}

// PassimpayUnlockFundsErr is the same as passimpayUnlockFunds but returns the
// error to the caller. Used by admin reject so failures bubble up to the staff
// member instead of being silently logged.
func PassimpayUnlockFundsErr(ctx context.Context, pool *pgxpool.Pool, userID, ccy string, amountMinor int64, idem, wid string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	meta := map[string]any{"provider_order_id": idem, "withdrawal_local": wid}
	keyCash := fmt.Sprintf("passimpay:wdr:comp:cash:%s", idem)
	keyPen := fmt.Sprintf("passimpay:wdr:comp:pending:%s", idem)
	if _, err := ledger.ApplyCreditTx(ctx, tx, userID, ccy, "withdrawal.compensation.cash", keyCash, amountMinor, meta); err != nil {
		return fmt.Errorf("credit cash: %w", err)
	}
	if _, err := ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "withdrawal.compensation.pending", keyPen, amountMinor, ledger.PocketPendingWithdrawal, meta); err != nil {
		return fmt.Errorf("debit pending: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func truncateForDB(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max]
}

// newAddressCipher returns a cipher initialized from cfg.WalletAddressKEK,
// or (nil, ErrKeyMissing) when the KEK isn't configured. Callers should
// fail closed in production.
func newAddressCipher(cfg *config.Config) (*cryptokit.AddressCipher, error) {
	if cfg == nil {
		return nil, cryptokit.ErrKeyMissing
	}
	return cryptokit.NewAddressCipher(cfg.WalletAddressKEK)
}

func cryptokitHashAddress(s string) string { return cryptokit.HashAddress(s) }
func cryptokitLast4(s string) string       { return cryptokit.Last4(s) }
