import { describe, expect, it } from 'vitest'
import { dailyHuntBarPercent, tierLadderBarPercent } from './vipProgressHelpers'

describe('tierLadderBarPercent', () => {
  it('clamps lifetime progress toward next tier between 6 and 100', () => {
    expect(tierLadderBarPercent(500_00, 1000_00)).toBe(50)
    expect(tierLadderBarPercent(1000_00, 1000_00)).toBe(100)
    expect(tierLadderBarPercent(1, 1_000_000_00)).toBe(6)
  })

  it('returns 100 when no next tier threshold (top tier / unknown)', () => {
    expect(tierLadderBarPercent(0, undefined)).toBe(100)
    expect(tierLadderBarPercent(1_000_00, 0)).toBe(100)
  })
})

describe('dailyHuntBarPercent', () => {
  it('tracks wager toward next milestone', () => {
    expect(dailyHuntBarPercent(250_00, 1000_00)).toBe(25)
    expect(dailyHuntBarPercent(1000_00, 1000_00)).toBe(100)
  })

  it('full bar when no next threshold but accrued wager (completed milestones)', () => {
    expect(dailyHuntBarPercent(500_00, null)).toBe(100)
    expect(dailyHuntBarPercent(1, undefined)).toBe(100)
  })

  it('zero when no programme activity and no next threshold', () => {
    expect(dailyHuntBarPercent(0, null)).toBe(0)
    expect(dailyHuntBarPercent(0, undefined)).toBe(0)
  })
})
