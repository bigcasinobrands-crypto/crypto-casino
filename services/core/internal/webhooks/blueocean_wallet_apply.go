package webhooks

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func applyBOSeamlessWithRetry(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, userID, ccy string, multiCurrency, allowNeg, skipBonusBetGuards, ledgerUsesRound bool, action, remote, txnWire, ledgerTxn string, amount int64, gameID string, persist boSeamlessPersistMeta) (
	replay []byte, sum int64, st int, boMsg string, notifyWR bool, replayed bool, lastErr error,
) {
	for attempt := 0; attempt < boWalletTxMaxAttempts; attempt++ {
		if attempt > 0 {
			shift := min(attempt-1, 6)
			backoff := time.Duration(1<<shift) * time.Millisecond
			if backoff > 100*time.Millisecond {
				backoff = 100 * time.Millisecond
			}
			select {
			case <-ctx.Done():
				return nil, 0, 0, "", false, false, context.Cause(ctx)
			case <-time.After(backoff):
			}
		}
		replay, sum, st, boMsg, notifyWR, replayed, lastErr = applyBOSeamless(ctx, pool, rdb, userID, ccy, multiCurrency, allowNeg, skipBonusBetGuards, ledgerUsesRound, action, remote, txnWire, ledgerTxn, amount, gameID, persist)
		if lastErr == nil {
			return replay, sum, st, boMsg, notifyWR, replayed, nil
		}
		if !isBOWalletTxRetryable(lastErr) {
			return replay, sum, st, boMsg, notifyWR, replayed, lastErr
		}
		log.Printf("blueocean wallet: transient DB error, retrying (%d/%d): %v", attempt+1, boWalletTxMaxAttempts, lastErr)
	}
	return replay, sum, st, boMsg, notifyWR, replayed, lastErr
}

func applyBOSeamless(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, userID, ccy string, multiCurrency, allowNeg, skipBonusBetGuards, ledgerUsesRound bool, action, remote, txnWire, ledgerTxn string, amount int64, gameID string, persist boSeamlessPersistMeta) (
	replay []byte, postBal int64, status int, msg string, notifyWageringProgress bool, replayed bool, err error,
) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, 0, 500, "", false, false, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	keyRemote := boWalletKeyRemoteTx(ctx, tx, userID, remote)
	altRemote := strings.TrimSpace(remote)
	if altRemote != "" && boWalletRemoteNorm(altRemote) == boWalletRemoteNorm(keyRemote) {
		altRemote = ""
	}

	var boRowID int64
	if txnWire != "" && txnWire != "na" && (action == "debit" || action == "credit" || action == "rollback") {
		persistCopy := persist
		if action != "rollback" {
			am := amount
			persistCopy.AmountMinor = &am
		}
		var rep []byte
		var repBal int64
		var repSt int
		boRowID, rep, repBal, repSt, err = boWalletTxAcquire(ctx, tx, userID, keyRemote, action, txnWire, ccy, persistCopy)
		if err != nil {
			return nil, 0, 500, "", false, false, err
		}
		if len(rep) > 0 {
			slog.Info("blueocean wallet replay",
				slog.String("action", action),
				slog.String("remote_id", remote),
				slog.String("resolved_remote_key", keyRemote),
				slog.String("user_id", userID),
				slog.String("transaction_id", txnWire),
				slog.Bool("duplicate_detected", true),
			)
			if err := tx.Commit(ctx); err != nil {
				return nil, 0, 500, "", false, false, err
			}
			committed = true
			return rep, repBal, repSt, "", false, true, nil
		}
	}

	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1::uuid FOR UPDATE`, userID); err != nil {
		return nil, 0, 500, "", false, false, err
	}

	meta := map[string]any{"remote_id": remote, "txn": txnWire, "game_id": gameID}
	if err := fingerprint.MergeTrafficAttributionTx(ctx, tx, userID, time.Now().UTC(), meta); err != nil {
		return nil, 0, 500, "", false, false, err
	}

	bal, err := ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
	if err != nil {
		return nil, 0, 500, "", false, false, err
	}
	openBal := bal
	rollbackMetaTarget := ""

	finish := func(st int, balBefore int64, balAfter int64, amt *int64, m string) ([]byte, int64, int, string, error) {
		body, jerr := boMarshalWalletResponseJSON(st, balAfter, m)
		if jerr != nil {
			return nil, 0, 500, "", jerr
		}
		if boRowID != 0 {
			if serr := boSaveWalletTxResponse(ctx, tx, boRowID, st, balBefore, balAfter, amt, body); serr != nil {
				return nil, 0, 500, "", serr
			}
			if action == "rollback" && rollbackMetaTarget != "" {
				if serr := boSetRollbackTargetAction(ctx, tx, boRowID, rollbackMetaTarget); serr != nil {
					return nil, 0, 500, "", serr
				}
			}
		}
		if cerr := tx.Commit(ctx); cerr != nil {
			return nil, 0, 500, "", cerr
		}
		committed = true
		return body, balAfter, st, m, nil
	}

	switch action {
	case "debit":
		slog.Info("blueocean wallet debit",
			slog.String("action", "debit"),
			slog.String("remote_id", remote),
			slog.String("username", persist.Username),
			slog.String("transaction_id", txnWire),
			slog.String("ledger_txn", ledgerTxn),
			slog.String("round_id", persist.RoundID),
			slog.String("game_id", gameID),
			slog.Int64("amount_minor", amount),
		)
		if amount == 0 {
			bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			z := int64(0)
			rep, pb, st, m, err := finish(200, openBal, bal, &z, "")
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			return rep, pb, st, m, false, false, nil
		}
		net, nerr := boTxnNetLedgerMinor(ctx, tx, userID, keyRemote, altRemote, txnWire, ledgerTxn)
		if nerr != nil {
			return nil, 0, 500, "", false, false, nerr
		}
		if net < 0 {
			if amount != -net {
				rep, pb, st, m, err := finish(403, openBal, bal, &amount, "Invalid amount")
				if err != nil {
					return nil, 0, 500, "", false, false, err
				}
				return rep, pb, st, m, false, false, nil
			}
			bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			rep, pb, st, m, err := finish(200, openBal, bal, &amount, "")
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			return rep, pb, st, m, false, false, nil
		}
		if !skipBonusBetGuards {
			srcRef := userID + ":" + keyRemote + ":" + ledgerTxn
			if err := bonus.CheckBetAllowedTx(ctx, tx, userID, gameID, amount, srcRef); err != nil {
				if errors.Is(err, bonus.ErrExcludedGame) || errors.Is(err, bonus.ErrMaxBetExceeded) {
					rep, pb, st, m, err := finish(403, openBal, bal, &amount, "")
					if err != nil {
						return nil, 0, 500, "", false, false, err
					}
					return rep, pb, st, m, false, false, nil
				}
				return nil, 0, 500, "", false, false, err
			}
		}
		if !allowNeg && bal < amount {
			rep, pb, st, m, err := finish(403, openBal, bal, &amount, "Insufficient funds")
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			return rep, pb, st, m, false, false, nil
		}
		bonusBal, err := ledger.BalanceBonusLockedSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
		if err != nil {
			return nil, 0, 500, "", false, false, err
		}
		cashBal, err := ledger.BalanceCashSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
		if err != nil {
			return nil, 0, 500, "", false, false, err
		}
		fromCash := amount
		if fromCash > cashBal {
			fromCash = cashBal
		}
		fromBonus := amount - fromCash
		if fromBonus > bonusBal {
			if !allowNeg {
				rep, pb, st, m, err := finish(403, openBal, bal, &amount, "Insufficient funds")
				if err != nil {
					return nil, 0, 500, "", false, false, err
				}
				return rep, pb, st, m, false, false, nil
			}
			fromBonus = bonusBal
			fromCash = amount - fromBonus
		}
		if fromCash > 0 {
			idemC := fmt.Sprintf("blueocean:%s:%s:debit:%s:cash", userID, keyRemote, ledgerTxn)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemC, fromCash, ledger.PocketCash, meta)
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
		}
		if fromBonus > 0 {
			idemB := fmt.Sprintf("blueocean:%s:%s:debit:%s:bonus", userID, keyRemote, ledgerTxn)
			_, err = ledger.ApplyDebitTxWithPocket(ctx, tx, userID, ccy, "game.debit", idemB, fromBonus, ledger.PocketBonusLocked, meta)
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
		}
		netAfter, nErr := boTxnNetLedgerMinor(ctx, tx, userID, keyRemote, altRemote, txnWire, ledgerTxn)
		if nErr != nil {
			return nil, 0, 500, "", false, false, nErr
		}
		if netAfter != -amount {
			return nil, 0, 500, "", false, false, fmt.Errorf("blueocean wallet: debit ledger net %d != -%d (txn %s)", netAfter, amount, txnWire)
		}
		if boRowID != 0 {
			_, sErr := tx.Exec(ctx, `
				UPDATE blueocean_wallet_transactions
				SET debit_ledger_idem_suffix = NULLIF(trim(both from $2), ''),
				    debit_from_cash_minor = $3,
				    debit_from_bonus_minor = $4,
				    updated_at = now()
				WHERE id = $1
			`, boRowID, ledgerTxn, fromCash, fromBonus)
			if sErr != nil {
				return nil, 0, 500, "", false, false, sErr
			}
		}
		wrUpdated, werr := bonus.ApplyPostBetWagering(ctx, tx, userID, gameID, amount)
		if werr != nil {
			return nil, 0, 500, "", false, false, werr
		}
		notifyWageringProgress = wrUpdated

	case "credit":
		if amount == 0 {
			bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			z := int64(0)
			rep, pb, st, m, err := finish(200, openBal, bal, &z, "")
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			return rep, pb, st, m, false, false, nil
		}
		idemP := fmt.Sprintf("blueocean:%s:%s:credit:%s", userID, keyRemote, ledgerTxn)
		if _, err = ledger.ApplyCreditTx(ctx, tx, userID, ccy, "game.credit", idemP, amount, meta); err != nil {
			return nil, 0, 500, "", false, false, err
		}
		sumC, sErr := sumLedgerKeysINForUser(ctx, tx, userID, boCreditScanKeysAggregate(userID, keyRemote, altRemote, txnWire, ledgerTxn))
		if sErr != nil {
			return nil, 0, 500, "", false, false, sErr
		}
		if sumC != amount {
			return nil, 0, 500, "", false, false, fmt.Errorf("blueocean wallet: credit ledger sum %d != amount %d (txn %s)", sumC, amount, txnWire)
		}

	case "rollback":
		debitRowID, debitStoredTxn, debitSuffix, debitRound, debitAmtMinor, debitHasAmt, splitCash, splitBonus, hasDebitSnap, debitRolled, dErr := boLockOriginalDebitWalletRow(ctx, tx, userID, keyRemote, txnWire)
		if dErr != nil {
			return nil, 0, 500, "", false, false, dErr
		}
		var creditRowID int64
		var creditStoredTxn, creditRound string
		var creditAmtMinor int64
		var creditHasAmt, creditRolled bool
		if debitRowID == 0 {
			creditRowID, creditStoredTxn, creditRound, creditAmtMinor, creditHasAmt, creditRolled, dErr = boLockOriginalCreditWalletRow(ctx, tx, userID, keyRemote, txnWire)
			if dErr != nil {
				return nil, 0, 500, "", false, false, dErr
			}
		}

		slog.Info("blueocean wallet rollback",
			slog.String("action", "rollback"),
			slog.String("remote_id", remote),
			slog.String("username", persist.Username),
			slog.String("transaction_id", txnWire),
			slog.String("ledger_txn", ledgerTxn),
			slog.String("round_id", persist.RoundID),
			slog.String("game_id", gameID),
			slog.Int64("debit_row_id", debitRowID),
			slog.Bool("debit_rolled_back", debitRolled),
			slog.Bool("debit_row_found", debitRowID != 0),
			slog.Bool("debit_has_ledger_snap", hasDebitSnap),
			slog.Int64("credit_row_id", creditRowID),
			slog.Bool("credit_rolled_back", creditRolled),
			slog.Bool("credit_row_found", creditRowID != 0),
		)

		if debitRowID == 0 && creditRowID == 0 {
			rep, pb, st, m, err := finish(404, openBal, bal, nil, "TRANSACTION_NOT_FOUND")
			if err != nil {
				return nil, 0, 500, "", false, false, err
			}
			return rep, pb, st, m, false, false, nil
		}

		if debitRowID != 0 {
			rollbackMetaTarget = "debit"
			if debitRolled {
				rep, rb, rs, ok, rerr := boFindCompletedRollbackReplay(ctx, tx, userID, txnWire)
				if rerr != nil {
					return nil, 0, 500, "", false, false, rerr
				}
				if ok {
					if serr := boSaveWalletTxResponse(ctx, tx, boRowID, rs, openBal, rb, nil, rep); serr != nil {
						return nil, 0, 500, "", false, false, serr
					}
					if serr := boSetRollbackTargetAction(ctx, tx, boRowID, rollbackMetaTarget); serr != nil {
						return nil, 0, 500, "", false, false, serr
					}
					if _, rbu := tx.Exec(ctx, `UPDATE blueocean_wallet_transactions SET rollback_of_transaction_id = $2 WHERE id = $1`, boRowID, debitStoredTxn); rbu != nil {
						return nil, 0, 500, "", false, false, rbu
					}
					if cerr := tx.Commit(ctx); cerr != nil {
						return nil, 0, 500, "", false, false, cerr
					}
					committed = true
					return rep, rb, rs, "", false, true, nil
				}
				bal, berr := ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
				if berr != nil {
					return nil, 0, 500, "", false, false, berr
				}
				rep, pb, st, m, ferr := finish(200, openBal, bal, nil, "")
				if ferr != nil {
					return nil, 0, 500, "", false, false, ferr
				}
				return rep, pb, st, m, false, false, nil
			}

			stakeWire := strings.TrimSpace(debitStoredTxn)
			if stakeWire == "" {
				stakeWire = txnWire
			}
			stakeLedger := strings.TrimSpace(debitSuffix)
			if stakeLedger == "" {
				stakeLedger = boLedgerTxnIDForDebitRow(debitStoredTxn, debitRound, ledgerUsesRound)
			}

			creditKeys := boCreditScanKeysAggregateMerged(userID, keyRemote, altRemote, txnWire, ledgerTxn, stakeWire, stakeLedger)
			winKeys := boWinRollbackScanKeysAggregateMerged(userID, keyRemote, altRemote, txnWire, ledgerTxn, stakeWire, stakeLedger)

			creditSum, rerr := sumLedgerKeysINForUser(ctx, tx, userID, creditKeys)
			if rerr != nil {
				return nil, 0, 500, "", false, false, rerr
			}
			winReversedSum, rerr := sumLedgerKeysINForUser(ctx, tx, userID, winKeys)
			if rerr != nil {
				return nil, 0, 500, "", false, false, rerr
			}
			outstandingWin := creditSum + winReversedSum

			var fb, fc int64
			if hasDebitSnap {
				fb, fc = splitBonus, splitCash
			}
			if fb+fc == 0 {
				fb, fc = maxDebitMagBonusCash(ctx, tx, userID, keyRemote, altRemote, stakeWire, stakeLedger)
			}
			if fb+fc == 0 && debitHasAmt && debitAmtMinor > 0 {
				fb, fc = 0, debitAmtMinor
			}
			if fb+fc == 0 {
				rep, pb, st, m, err := finish(404, openBal, bal, nil, "TRANSACTION_NOT_FOUND")
				if err != nil {
					return nil, 0, 500, "", false, false, err
				}
				return rep, pb, st, m, false, false, nil
			}

			winRBKeyP := fmt.Sprintf("blueocean:%s:%s:rollback_win:%s", userID, keyRemote, stakeLedger)

			var wrRollbackStake int64
			if fb > 0 {
				idemRB := fmt.Sprintf("blueocean:%s:%s:rollback:%s:bonus", userID, keyRemote, stakeLedger)
				ins, rerr := ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRB, fb, ledger.PocketBonusLocked, meta)
				if rerr != nil {
					return nil, 0, 500, "", false, false, rerr
				}
				if ins {
					wrRollbackStake += fb
					if err := bonus.ReverseVIPAccrualForBonusRollbackTx(ctx, tx, userID, fb, idemRB); err != nil {
						return nil, 0, 500, "", false, false, err
					}
				}
			}
			if fc > 0 {
				idemRC := fmt.Sprintf("blueocean:%s:%s:rollback:%s:cash", userID, keyRemote, stakeLedger)
				ins, rerr := ledger.ApplyCreditTxWithPocket(ctx, tx, userID, ccy, "game.rollback", idemRC, fc, ledger.PocketCash, meta)
				if rerr != nil {
					return nil, 0, 500, "", false, false, rerr
				}
				if ins {
					wrRollbackStake += fc
					if err := bonus.ReverseVIPAccrualForCashRollbackTx(ctx, tx, userID, fc, idemRC); err != nil {
						return nil, 0, 500, "", false, false, err
					}
				}
			}
			if wrRollbackStake > 0 {
				wrRbUpdated, werr := bonus.ApplyPostBetRollbackWagering(ctx, tx, userID, gameID, wrRollbackStake)
				if werr != nil {
					return nil, 0, 500, "", false, false, werr
				}
				if wrRbUpdated {
					notifyWageringProgress = true
				}
			}
			_, uerr := tx.Exec(ctx, `UPDATE blueocean_wallet_transactions SET rolled_back = true, updated_at = now() WHERE id = $1`, debitRowID)
			if uerr != nil {
				return nil, 0, 500, "", false, false, uerr
			}

			if outstandingWin > 0 {
				curBal, cerr := ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
				if cerr != nil {
					return nil, 0, 500, "", false, false, cerr
				}
				if curBal < outstandingWin {
					rep, pb, st, m, err := finish(403, openBal, curBal, nil, "Insufficient funds")
					if err != nil {
						return nil, 0, 500, "", false, false, err
					}
					return rep, pb, st, m, false, false, nil
				}
				_, err = ledger.ApplyDebitTx(ctx, tx, userID, ccy, ledger.EntryTypeGameWinRollback, winRBKeyP, outstandingWin, meta)
				if err != nil {
					return nil, 0, 500, "", false, false, err
				}
			}

			if boRowID != 0 {
				if _, err := tx.Exec(ctx, `UPDATE blueocean_wallet_transactions SET rollback_of_transaction_id = $2 WHERE id = $1`, boRowID, debitStoredTxn); err != nil {
					return nil, 0, 500, "", false, false, err
				}
			}
		} else {
			rollbackMetaTarget = "credit"
			if creditRolled {
				rep, rb, rs, ok, rerr := boFindCompletedRollbackReplay(ctx, tx, userID, txnWire)
				if rerr != nil {
					return nil, 0, 500, "", false, false, rerr
				}
				if ok {
					if serr := boSaveWalletTxResponse(ctx, tx, boRowID, rs, openBal, rb, nil, rep); serr != nil {
						return nil, 0, 500, "", false, false, serr
					}
					if serr := boSetRollbackTargetAction(ctx, tx, boRowID, rollbackMetaTarget); serr != nil {
						return nil, 0, 500, "", false, false, serr
					}
					if _, rbu := tx.Exec(ctx, `UPDATE blueocean_wallet_transactions SET rollback_of_transaction_id = $2 WHERE id = $1`, boRowID, creditStoredTxn); rbu != nil {
						return nil, 0, 500, "", false, false, rbu
					}
					if cerr := tx.Commit(ctx); cerr != nil {
						return nil, 0, 500, "", false, false, cerr
					}
					committed = true
					return rep, rb, rs, "", false, true, nil
				}
				bal, berr := ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
				if berr != nil {
					return nil, 0, 500, "", false, false, berr
				}
				rep, pb, st, m, ferr := finish(200, openBal, bal, nil, "")
				if ferr != nil {
					return nil, 0, 500, "", false, false, ferr
				}
				return rep, pb, st, m, false, false, nil
			}

			rowStakeLedger := boLedgerTxnIDForDebitRow(creditStoredTxn, creditRound, ledgerUsesRound)
			reqLedgerTxn := strings.TrimSpace(ledgerTxn)
			creditKeys := boCreditScanKeysAggregateMerged(userID, keyRemote, altRemote, creditStoredTxn, rowStakeLedger, txnWire, reqLedgerTxn)
			sumC, rerr := sumLedgerKeysINForUser(ctx, tx, userID, creditKeys)
			if rerr != nil {
				return nil, 0, 500, "", false, false, rerr
			}
			reverseAmt := sumC
			if reverseAmt <= 0 && creditHasAmt && creditAmtMinor > 0 {
				reverseAmt = creditAmtMinor
			}
			if reverseAmt <= 0 {
				rep, pb, st, m, err := finish(404, openBal, bal, nil, "TRANSACTION_NOT_FOUND")
				if err != nil {
					return nil, 0, 500, "", false, false, err
				}
				return rep, pb, st, m, false, false, nil
			}

			idemSuffix := rowStakeLedger
			if idemSuffix == "" {
				idemSuffix = reqLedgerTxn
			}
			if idemSuffix == "" {
				idemSuffix = strings.TrimSpace(creditStoredTxn)
			}
			idemRev := fmt.Sprintf("blueocean:%s:%s:rollback_credit:%s", userID, keyRemote, idemSuffix)
			if _, err := ledger.ApplyDebitTx(ctx, tx, userID, ccy, ledger.EntryTypeGameWinRollback, idemRev, reverseAmt, meta); err != nil {
				return nil, 0, 500, "", false, false, err
			}

			_, uerr := tx.Exec(ctx, `UPDATE blueocean_wallet_transactions SET rolled_back = true, updated_at = now() WHERE id = $1`, creditRowID)
			if uerr != nil {
				return nil, 0, 500, "", false, false, uerr
			}

			if boRowID != 0 {
				if _, err := tx.Exec(ctx, `UPDATE blueocean_wallet_transactions SET rollback_of_transaction_id = $2 WHERE id = $1`, boRowID, creditStoredTxn); err != nil {
					return nil, 0, 500, "", false, false, err
				}
			}
		}
	}

	bal, err = ledger.BalancePlayableSeamlessTx(ctx, tx, userID, ccy, multiCurrency)
	if err != nil {
		return nil, 0, 500, "", false, false, err
	}
	body, jerr := boMarshalWalletResponseJSON(200, bal, "")
	if jerr != nil {
		return nil, 0, 500, "", false, false, jerr
	}
	if boRowID != 0 {
		var amtPtr *int64
		if action != "rollback" {
			amtPtr = &amount
		}
		if serr := boSaveWalletTxResponse(ctx, tx, boRowID, 200, openBal, bal, amtPtr, body); serr != nil {
			return nil, 0, 500, "", false, false, serr
		}
		if action == "rollback" && rollbackMetaTarget != "" {
			if serr := boSetRollbackTargetAction(ctx, tx, boRowID, rollbackMetaTarget); serr != nil {
				return nil, 0, 500, "", false, false, serr
			}
		}
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return nil, 0, 500, "", false, false, cerr
	}
	committed = true

	if (action == "debit" || action == "rollback") && notifyWageringProgress && rdb != nil {
		if pubErr := bonus.PublishWageringProgressFromPool(ctx, pool, rdb, userID); pubErr != nil {
			log.Printf("blueocean wallet: redis publish wagering progress: %v", pubErr)
		}
	}
	return body, bal, 200, "", notifyWageringProgress, false, nil
}
