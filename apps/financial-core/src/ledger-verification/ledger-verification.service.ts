import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  DepositStatus,
  LedgerAccountType,
  WithdrawalStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { ledgerScopeKey } from '../ledger/scope-key';
import {
  computeCashFirstStake,
  stakeIsFullyFunded,
} from '../ledger/cash-first';
import {
  allow,
  deny,
  type Decimalish,
  type LedgerVerificationResult,
} from './ledger-verification.types';

/**
 * **Gate** every monetary workflow against ledger-derived truth.
 * Does not mutate ledger — callers invoke `LedgerService` only after `allowed`.
 */
@Injectable()
export class LedgerVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async verifyDepositCanCredit(params: {
    provider: string;
    chainId: string;
    txHash: string;
    logIndex: number;
    userId: string;
    amountMinor: bigint;
    ledgerIdempotencyKey: string;
  }): Promise<LedgerVerificationResult> {
    const dup = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: params.ledgerIdempotencyKey },
    });
    if (dup) {
      return deny(
        'DEPOSIT_ALREADY_CREDITED',
        { existingTransactionId: dup.id, idempotencyKey: params.ledgerIdempotencyKey },
        'NONE',
        'LOW',
      );
    }
    const dep = await this.prisma.deposit.findFirst({
      where: {
        chainId: params.chainId,
        txHash: params.txHash,
        logIndex: params.logIndex,
      },
    });
    if (dep && dep.status === DepositStatus.CREDITED) {
      return deny(
        'DEPOSIT_ROW_ALREADY_CREDITED',
        { depositId: dep.id },
        'NONE',
        'MEDIUM',
      );
    }
    return allow('DEPOSIT_VERIFICATION_OK', { deposit: dep?.id ?? null });
  }

  async verifyWithdrawalCanRequest(
    userId: string,
    amount: Decimalish,
    currency: string,
  ): Promise<LedgerVerificationResult> {
    const amt = new Decimal(amount);
    if (amt.lte(0)) {
      return deny(
        'WITHDRAWAL_AMOUNT_INVALID',
        { amount: amt.toString() },
        'BLOCK',
        'LOW',
      );
    }
    const cash = await this.ledger.getUserPocketBalance(
      userId,
      'USER_CASH',
      currency,
    );
    if (cash.lt(amt)) {
      return deny(
        'INSUFFICIENT_CASH',
        { cash: cash.toString(), requested: amt.toString(), currency },
        'BLOCK',
        'LOW',
      );
    }
    return allow('WITHDRAWAL_REQUEST_OK', {
      availableCash: cash.toString(),
      currency,
    });
  }

  async verifyWithdrawalIsLocked(
    withdrawalId: string,
  ): Promise<LedgerVerificationResult> {
    const w = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
    });
    if (!w) {
      return deny('WITHDRAWAL_NOT_FOUND', {}, 'BLOCK', 'HIGH');
    }
    const lockedStates: WithdrawalStatus[] = [
      WithdrawalStatus.LEDGER_LOCKED,
      WithdrawalStatus.QUEUED,
      WithdrawalStatus.SIGNING,
      WithdrawalStatus.BROADCAST,
      WithdrawalStatus.CONFIRMED,
    ];
    if (!lockedStates.includes(w.status)) {
      return deny(
        'WITHDRAWAL_NOT_LEDGER_LOCKED',
        { status: w.status },
        'BLOCK',
        'HIGH',
      );
    }
    return allow('WITHDRAWAL_LOCK_OK', {
      withdrawalId,
      status: w.status,
      amountMinor: w.amountMinor.toString(),
    });
  }

  async verifyBetCanDebit(
    userId: string,
    amount: Decimalish,
    currency: string,
  ): Promise<LedgerVerificationResult> {
    const stake = new Decimal(amount);
    const { cash, bonus } = await this.ledger.getPlayableBalances(
      userId,
      currency,
    );
    const split = computeCashFirstStake(stake, cash, bonus);
    if (!stakeIsFullyFunded(stake, split)) {
      return deny(
        'INSUFFICIENT_PLAYABLE_BALANCE',
        {
          stake: stake.toString(),
          cash: cash.toString(),
          bonus: bonus.toString(),
          split: {
            fromCash: split.fromCash.toString(),
            fromBonus: split.fromBonus.toString(),
          },
        },
        'BLOCK',
        'LOW',
      );
    }
    return allow('BET_DEBIT_OK', {
      cash: cash.toString(),
      bonus: bonus.toString(),
      cashFirst: {
        fromCash: split.fromCash.toString(),
        fromBonus: split.fromBonus.toString(),
      },
    });
  }

  async verifyWinCanCredit(params: {
    providerRoundId: string;
    providerSettlementId: string;
    betIdempotencyKey: string;
  }): Promise<LedgerVerificationResult> {
    const betTxn = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: params.betIdempotencyKey },
    });
    if (!betTxn) {
      return deny(
        'WIN_WITHOUT_PRIOR_BET_TXN',
        { betIdempotencyKey: params.betIdempotencyKey },
        'BLOCK',
        'HIGH',
      );
    }
    const winKey = `blueocean:win:${params.providerSettlementId}`;
    const dup = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: winKey },
    });
    if (dup) {
      return deny(
        'WIN_ALREADY_POSTED',
        { transactionId: dup.id },
        'NONE',
        'LOW',
      );
    }
    return allow('WIN_CREDIT_OK', {
      betTransactionId: betTxn.id,
      providerRoundId: params.providerRoundId,
    });
  }

  async verifyRollbackCanApply(
    originalTransactionId: string,
  ): Promise<LedgerVerificationResult> {
    const idem = `reversal:txn:${originalTransactionId}`;
    const rev = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: idem },
    });
    if (rev) {
      return deny(
        'ROLLBACK_ALREADY_APPLIED',
        { reversalTransactionId: rev.id },
        'NONE',
        'LOW',
      );
    }
    return allow('ROLLBACK_OK', { originalTransactionId, expectedReversalIdempotency: idem });
  }

  async verifyBonusCanGrant(
    userId: string,
    bonusType: string,
    referenceId: string,
  ): Promise<LedgerVerificationResult> {
    const idem = `bonus:grant:${bonusType}:${referenceId}:${userId}`;
    const exists = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: idem },
    });
    if (exists) {
      return deny('BONUS_GRANT_DUPLICATE', { idempotencyKey: idem }, 'NONE', 'LOW');
    }
    return allow('BONUS_GRANT_OK', { idempotencyKey: idem });
  }

  async verifyBonusCanConvert(
    userId: string,
    bonusId: string,
  ): Promise<LedgerVerificationResult> {
    const b = await this.prisma.bonusInstance.findFirst({
      where: { id: bonusId, userId },
    });
    if (!b) return deny('BONUS_NOT_FOUND', { bonusId }, 'BLOCK', 'MEDIUM');
    return allow('BONUS_CONVERT_OK', { status: b.status });
  }

  async verifyCashbackCanIssue(
    userId: string,
    period: string,
  ): Promise<LedgerVerificationResult> {
    const idem = `cashback:issue:${userId}:${period}`;
    const exists = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: idem },
    });
    if (exists) {
      return deny('CASHBACK_ALREADY_ISSUED', { idempotencyKey: idem }, 'NONE', 'LOW');
    }
    return allow('CASHBACK_ISSUE_OK', { period });
  }

  async verifyRakebackCanIssue(
    userId: string,
    period: string,
  ): Promise<LedgerVerificationResult> {
    const idem = `rakeback:issue:${userId}:${period}`;
    const exists = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: idem },
    });
    if (exists) {
      return deny('RAKEBACK_ALREADY_ISSUED', { idempotencyKey: idem }, 'NONE', 'LOW');
    }
    return allow('RAKEBACK_ISSUE_OK', { period });
  }

  async verifyVipRewardCanIssue(
    userId: string,
    rewardId: string,
  ): Promise<LedgerVerificationResult> {
    const idem = `vip:reward:${userId}:${rewardId}`;
    const exists = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: idem },
    });
    if (exists) {
      return deny('VIP_REWARD_DUPLICATE', { idempotencyKey: idem }, 'NONE', 'LOW');
    }
    return allow('VIP_REWARD_OK', { rewardId });
  }

  async verifyChallengeRewardCanIssue(
    userId: string,
    challengeId: string,
  ): Promise<LedgerVerificationResult> {
    const idem = `challenge:reward:${userId}:${challengeId}`;
    const exists = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: idem },
    });
    if (exists) {
      return deny('CHALLENGE_REWARD_DUPLICATE', { idempotencyKey: idem }, 'NONE', 'LOW');
    }
    return allow('CHALLENGE_REWARD_OK', { challengeId });
  }

  async verifyAffiliateCommissionCanIssue(
    affiliateId: string,
    period: string,
  ): Promise<LedgerVerificationResult> {
    const idem = `affiliate:commission:${affiliateId}:${period}`;
    const exists = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: idem },
    });
    if (exists) {
      return deny(
        'AFFILIATE_COMMISSION_DUPLICATE',
        { idempotencyKey: idem },
        'NONE',
        'LOW',
      );
    }
    return allow('AFFILIATE_COMMISSION_OK', { period });
  }

  async verifyAdminCorrectionCanApply(
    adminId: string,
    userId: string,
    amount: Decimalish,
  ): Promise<LedgerVerificationResult> {
    if (!adminId) {
      return deny('ADMIN_ID_REQUIRED', {}, 'BLOCK', 'CRITICAL');
    }
    const amt = new Decimal(amount);
    if (amt.isZero()) {
      return deny('AMOUNT_ZERO', {}, 'BLOCK', 'LOW');
    }
    return allow('ADMIN_CORRECTION_PRECHECK_OK', { adminId, userId });
  }

  async verifyTreasuryCanSweep(
    walletId: string,
    amount: Decimalish,
  ): Promise<LedgerVerificationResult> {
    const amt = new Decimal(amount);
    if (amt.lte(0)) {
      return deny('SWEEP_AMOUNT_INVALID', { walletId }, 'BLOCK', 'MEDIUM');
    }
    return allow('TREASURY_SWEEP_OK', { walletId, amount: amt.toString() });
  }

  async verifySystemSolvency(currency: string): Promise<LedgerVerificationResult> {
    const ccy = currency.toUpperCase();
    const sk = ledgerScopeKey(LedgerAccountType.TREASURY_ASSET, ccy, null);
    const ta = await this.prisma.ledgerAccount.findUnique({ where: { scopeKey: sk } });
    const treasuryBal = ta
      ? await this.ledger.getBalance(ta.id)
      : new Decimal(0);
    return allow('SOLVENCY_SNAPSHOT', {
      currency: ccy,
      treasuryEconomicBalance: treasuryBal.toString(),
      note:
        'Full solvency compares on-chain + user liabilities in ReconciliationModule',
    });
  }
}
