import { LedgerAccountType, LedgerSide } from '@prisma/client';
import Decimal from 'decimal.js';
import type { PrismaService } from '../prisma/prisma.service';

/** Asset-style accounts: economic balance = debits − credits. */
const DEBIT_NORMAL = new Set<LedgerAccountType>([
  LedgerAccountType.TREASURY_ASSET,
  LedgerAccountType.CASINO_REVENUE,
  LedgerAccountType.SPORTSBOOK_REVENUE,
  LedgerAccountType.BONUS_EXPENSE,
  LedgerAccountType.VIP_EXPENSE,
  LedgerAccountType.CASHBACK_EXPENSE,
  LedgerAccountType.RAKEBACK_EXPENSE,
]);

/**
 * Returns economic balance (positive = “normal” direction for that account class).
 * Liability / user pockets: credit − debit.
 * Assets & expense lines on posting: follow DEBIT_NORMAL set.
 */
export function economicBalance(
  accountType: LedgerAccountType,
  debitTotal: Decimal,
  creditTotal: Decimal,
): Decimal {
  if (DEBIT_NORMAL.has(accountType)) {
    return debitTotal.minus(creditTotal);
  }
  return creditTotal.minus(debitTotal);
}

export async function sumDebitCredit(
  prisma: PrismaService,
  accountId: string,
): Promise<{ debit: Decimal; credit: Decimal }> {
  const rows = await prisma.ledgerEntry.groupBy({
    by: ['side'],
    where: { accountId },
    _sum: { amount: true },
  });
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  for (const r of rows) {
    const s = r._sum.amount
      ? new Decimal(r._sum.amount.toString())
      : new Decimal(0);
    if (r.side === LedgerSide.DEBIT) debit = debit.plus(s);
    else credit = credit.plus(s);
  }
  return { debit, credit };
}
