import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  LedgerAccount,
  LedgerAccountType,
  LedgerTransaction,
  Prisma,
} from '@prisma/client';
import { LedgerAccountType as LAT } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import Decimal from 'decimal.js';
import { ledgerScopeKey } from './scope-key';
import type { PostingLineInput, PostTransactionOptions } from './ledger.types';
import { assertDoubleEntryBalanced } from './double-entry';
import {
  economicBalance,
  sumDebitCredit,
} from './ledger-balance.util';

/** Double-entry invariant: sum(DEBIT amounts) === sum(CREDIT amounts) per transaction. */
@Injectable()
export class LedgerService {
  private readonly log = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve or create account row for chart line — never stores balance. */
  async ensureAccount(
    tx: Prisma.TransactionClient,
    input: {
      type: PostingLineInput['accountType'];
      userId: string | null;
      currency: string;
    },
  ): Promise<LedgerAccount> {
    const scopeKey = ledgerScopeKey(
      input.type,
      input.currency,
      input.userId,
    );
    const existing = await tx.ledgerAccount.findUnique({
      where: { scopeKey },
    });
    if (existing) return existing;
    return tx.ledgerAccount.create({
      data: {
        type: input.type,
        userId: input.userId,
        currency: input.currency.toUpperCase(),
        scopeKey,
      },
    });
  }

  /**
   * Economic balance for an account (see `economicBalance` / ledger-balance.util).
   */
  async getBalance(accountId: string): Promise<Decimal> {
    const acct = await this.prisma.ledgerAccount.findUnique({
      where: { id: accountId },
    });
    if (!acct) {
      throw new BadRequestException('ledger: unknown account');
    }
    const { debit, credit } = await sumDebitCredit(this.prisma, accountId);
    return economicBalance(acct.type, debit, credit);
  }

  /** Resolve account id by scope key without creating. */
  async findAccountIdByScope(scopeKey: string): Promise<string | null> {
    const a = await this.prisma.ledgerAccount.findUnique({
      where: { scopeKey },
      select: { id: true },
    });
    return a?.id ?? null;
  }

  /** Playable wallets for gameplay (cash + bonus). Pending withdrawal lives in USER_PENDING_WITHDRAWAL — excluded here. */
  async getPlayableBalances(
    userId: string,
    currency: string,
  ): Promise<{ cash: Decimal; bonus: Decimal }> {
    const ccy = currency.toUpperCase();
    const cashKey = ledgerScopeKey(LAT.USER_CASH, ccy, userId);
    const bonusKey = ledgerScopeKey(LAT.USER_BONUS, ccy, userId);
    const [cashRow, bonusRow] = await Promise.all([
      this.prisma.ledgerAccount.findUnique({ where: { scopeKey: cashKey } }),
      this.prisma.ledgerAccount.findUnique({ where: { scopeKey: bonusKey } }),
    ]);
    let cash = new Decimal(0);
    let bonus = new Decimal(0);
    if (cashRow) {
      const { debit, credit } = await sumDebitCredit(this.prisma, cashRow.id);
      cash = economicBalance(LAT.USER_CASH, debit, credit);
    }
    if (bonusRow) {
      const { debit, credit } = await sumDebitCredit(this.prisma, bonusRow.id);
      bonus = economicBalance(LAT.USER_BONUS, debit, credit);
    }
    return { cash, bonus };
  }

  /** Total user-scoped liability-style balance for account type (cash, bonus, cashback, …). */
  async getUserPocketBalance(
    userId: string,
    pocket: Extract<
      LedgerAccountType,
      | 'USER_CASH'
      | 'USER_BONUS'
      | 'USER_CASHBACK'
      | 'USER_RAKEBACK'
      | 'USER_PENDING_WITHDRAWAL'
    >,
    currency: string,
  ): Promise<Decimal> {
    const ccy = currency.toUpperCase();
    const key = ledgerScopeKey(pocket, ccy, userId);
    const row = await this.prisma.ledgerAccount.findUnique({
      where: { scopeKey: key },
    });
    if (!row) return new Decimal(0);
    const { debit, credit } = await sumDebitCredit(this.prisma, row.id);
    return economicBalance(pocket, debit, credit);
  }

  /**
   * Posts a balanced transaction. Idempotent: duplicate idempotency_key returns existing txn + entries.
   */
  async postTransaction(
    lines: PostingLineInput[],
    opts: PostTransactionOptions,
  ): Promise<LedgerTransaction & { entries: import('@prisma/client').LedgerEntry[] }> {
    if (!lines.length) {
      throw new BadRequestException('ledger: no posting lines');
    }
    try {
      assertDoubleEntryBalanced(lines);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'ledger: unbalanced',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
        include: { entries: { orderBy: { lineNumber: 'asc' } } },
      });
      if (existing) {
        this.log.debug(`idempotent ledger replay ${opts.idempotencyKey}`);
        return existing;
      }

      const txn = await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: opts.idempotencyKey,
          correlationId: opts.correlationId ?? undefined,
          metadata: (opts.transactionMetadata ?? {}) as Prisma.InputJsonValue,
          createdBy: opts.createdBy ?? undefined,
        },
      });

      let lineNumber = 0;
      const entries: import('@prisma/client').LedgerEntry[] = [];
      for (const line of lines) {
        const acct = await this.ensureAccount(tx, {
          type: line.accountType,
          userId: line.userId,
          currency: line.currency,
        });
        lineNumber += 1;
        const amount = new Decimal(line.amount);
        if (amount.lte(0)) {
          throw new BadRequestException('ledger: amounts must be positive');
        }
        const row = await tx.ledgerEntry.create({
          data: {
            transactionId: txn.id,
            accountId: acct.id,
            amount,
            side: line.side,
            lineType: line.lineType,
            referenceId: line.referenceId ?? undefined,
            referenceType: line.referenceType ?? undefined,
            metadata: (line.metadata ?? {}) as Prisma.InputJsonValue,
            lineNumber,
          },
        });
        entries.push(row);
      }

      for (const ev of opts.domainEvents ?? []) {
        await tx.domainEvent.create({
          data: {
            eventType: ev.eventType,
            aggregateType: ev.aggregateType,
            aggregateId: ev.aggregateId,
            payload: ev.payload as Prisma.InputJsonValue,
            schemaVersion: ev.schemaVersion ?? 1,
            idempotencyKey: ev.idempotencyKey,
            correlationId: opts.correlationId ?? undefined,
            causationId: txn.id,
          },
        });
      }

      return { ...txn, entries };
    });
  }
}
