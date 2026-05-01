/**
 * Pure helpers for VIP tier + Daily Hunt progress bars on VipPage.
 * Kept testable: same math the UI uses must match these functions.
 */

export function tierLadderBarPercent(lifetimeWagerMinor: number, nextTierMinWagerMinor?: number): number {
  if (typeof nextTierMinWagerMinor === 'number' && nextTierMinWagerMinor > 0) {
    return Math.max(6, Math.min(100, (lifetimeWagerMinor / nextTierMinWagerMinor) * 100))
  }
  return 100
}

/**
 * Hunt bar toward the next milestone.
 * When there is no next threshold but accrued wager is positive, treat as completed milestones for today (full bar).
 * When nothing accrued and no next threshold (no programme or idle), 0%.
 */
export function dailyHuntBarPercent(wagerAccruedMinor: number, nextThresholdWagerMinor?: number | null): number {
  if (nextThresholdWagerMinor == null || nextThresholdWagerMinor <= 0) {
    return wagerAccruedMinor > 0 ? 100 : 0
  }
  return Math.max(6, Math.min(100, (wagerAccruedMinor / nextThresholdWagerMinor) * 100))
}
