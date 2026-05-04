import Decimal from 'decimal.js';

export interface CashFirstSplit {
  fromCash: Decimal;
  fromBonus: Decimal;
}

/**
 * Stake consumption: **cash first**, then bonus wallet.
 * Returns zero splits if stake cannot be covered.
 */
export function computeCashFirstStake(
  stakeAmount: Decimal,
  cashAvailable: Decimal,
  bonusAvailable: Decimal,
): CashFirstSplit {
  if (stakeAmount.lte(0)) {
    return { fromCash: new Decimal(0), fromBonus: new Decimal(0) };
  }
  const fromCash = Decimal.min(cashAvailable, stakeAmount);
  const remainder = stakeAmount.minus(fromCash);
  const fromBonus = Decimal.min(bonusAvailable, remainder);
  return { fromCash, fromBonus };
}

export function stakeIsFullyFunded(
  stakeAmount: Decimal,
  split: CashFirstSplit,
): boolean {
  return split.fromCash.plus(split.fromBonus).equals(stakeAmount);
}
