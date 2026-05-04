import { LedgerSide, LedgerAccountType, LedgerEntryLineType } from '@prisma/client';
import { assertDoubleEntryBalanced } from './double-entry';

describe('assertDoubleEntryBalanced', () => {
  it('accepts balanced pair', () => {
    expect(() =>
      assertDoubleEntryBalanced([
        {
          accountType: LedgerAccountType.USER_CASH,
          userId: '00000000-0000-0000-0000-000000000001',
          currency: 'USDT',
          side: LedgerSide.DEBIT,
          amount: '10',
          lineType: LedgerEntryLineType.BET_DEBIT,
        },
        {
          accountType: LedgerAccountType.CASINO_REVENUE,
          userId: null,
          currency: 'USDT',
          side: LedgerSide.CREDIT,
          amount: '10',
          lineType: LedgerEntryLineType.BET_DEBIT,
        },
      ]),
    ).not.toThrow();
  });

  it('rejects unbalanced pair', () => {
    expect(() =>
      assertDoubleEntryBalanced([
        {
          accountType: LedgerAccountType.USER_CASH,
          userId: '00000000-0000-0000-0000-000000000001',
          currency: 'USDT',
          side: LedgerSide.DEBIT,
          amount: '10',
          lineType: LedgerEntryLineType.BET_DEBIT,
        },
        {
          accountType: LedgerAccountType.CASINO_REVENUE,
          userId: null,
          currency: 'USDT',
          side: LedgerSide.CREDIT,
          amount: '9',
          lineType: LedgerEntryLineType.BET_DEBIT,
        },
      ]),
    ).toThrow(/unbalanced/);
  });
});
