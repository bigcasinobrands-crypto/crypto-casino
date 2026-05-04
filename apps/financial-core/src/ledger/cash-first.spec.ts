import Decimal from 'decimal.js';
import {
  computeCashFirstStake,
  stakeIsFullyFunded,
} from './cash-first';

describe('computeCashFirstStake', () => {
  it('uses cash only when sufficient', () => {
    const s = computeCashFirstStake(
      new Decimal(50),
      new Decimal(80),
      new Decimal(20),
    );
    expect(s.fromCash.toString()).toBe('50');
    expect(s.fromBonus.toString()).toBe('0');
    expect(
      stakeIsFullyFunded(new Decimal(50), s),
    ).toBe(true);
  });

  it('uses cash first then bonus', () => {
    const s = computeCashFirstStake(
      new Decimal(30),
      new Decimal(10),
      new Decimal(40),
    );
    expect(s.fromCash.toString()).toBe('10');
    expect(s.fromBonus.toString()).toBe('20');
    expect(
      stakeIsFullyFunded(new Decimal(30), s),
    ).toBe(true);
  });

  it('fails when underfunded', () => {
    const s = computeCashFirstStake(
      new Decimal(100),
      new Decimal(10),
      new Decimal(20),
    );
    expect(
      stakeIsFullyFunded(new Decimal(100), s),
    ).toBe(false);
  });
});
