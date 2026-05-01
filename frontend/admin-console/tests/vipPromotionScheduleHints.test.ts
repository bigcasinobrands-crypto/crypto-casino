import { describe, expect, it } from 'vitest'
import { projectNextRunForPipeline } from '../src/lib/vipPromotionScheduleHints'

describe('projectNextRunForPipeline', () => {
  it('advances weekly anchors that are in the past', () => {
    const now = new Date('2026-04-30T12:00:00.000Z')
    const past = new Date('2026-04-20T00:00:00.000Z')
    const next = projectNextRunForPipeline('weekly_bonus', past, now)
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime() - 60_000)
    const days = (next.getTime() - past.getTime()) / (24 * 60 * 60 * 1000)
    expect(Math.round(days) % 7).toBe(0)
  })

  it('advances monthly anchors that are in the past', () => {
    const now = new Date('2026-04-30T12:00:00.000Z')
    const past = new Date('2026-01-10T00:00:00.000Z')
    const next = projectNextRunForPipeline('monthly_bonus', past, now)
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime() - 60_000)
    expect(next.getUTCDate()).toBe(1)
  })
})
