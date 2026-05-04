import Decimal from 'decimal.js';
import { LedgerSide } from '@prisma/client';
import type { PostingLineInput } from './ledger.types';

export function assertDoubleEntryBalanced(lines: PostingLineInput[]): void {
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  for (const l of lines) {
    const a = new Decimal(l.amount);
    if (a.lte(0)) throw new Error('amount must be positive');
    if (l.side === LedgerSide.DEBIT) debit = debit.plus(a);
    else credit = credit.plus(a);
  }
  if (!debit.equals(credit)) {
    throw new Error(`unbalanced: debits=${debit} credits=${credit}`);
  }
}
