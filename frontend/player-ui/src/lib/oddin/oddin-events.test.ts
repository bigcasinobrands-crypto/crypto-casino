import { describe, expect, it } from 'vitest'
import {
  analyticsActionFromPayload,
  isTrackedAnalyticsAction,
  routeFromOddinEvent,
  safeJsonRecord,
} from './oddin-events'

describe('routeFromOddinEvent', () => {
  it('reads route field', () => {
    expect(routeFromOddinEvent({ type: 'ROUTE_CHANGE', route: 'live' })).toBe('live')
  })
  it('reads nested payload', () => {
    expect(routeFromOddinEvent({ type: 'ROUTE_CHANGE', payload: { route: 'pre-match' } })).toBe('pre-match')
  })
})

describe('analyticsActionFromPayload', () => {
  it('prefers action', () => {
    expect(analyticsActionFromPayload({ action: 'bet-accepted', x: 1 })).toBe('bet-accepted')
  })
})

describe('isTrackedAnalyticsAction', () => {
  it('recognizes known actions', () => {
    expect(isTrackedAnalyticsAction('bet-accepted')).toBe(true)
    expect(isTrackedAnalyticsAction('unknown')).toBe(false)
  })
})

describe('safeJsonRecord', () => {
  it('returns empty object for non-objects', () => {
    expect(safeJsonRecord(null)).toEqual({})
    expect(safeJsonRecord('x')).toEqual({})
  })
})
