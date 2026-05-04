import type { OddinIframeEvent } from './oddin.types'

/** Known Oddin analytics action names (best-effort). */
export const ODDIN_ANALYTICS_ACTIONS = [
  'bet-accepted',
  'match-in-view',
  'click-match-detail',
  'ticket-add-selection',
  'ticket-remove-selection',
] as const

export type OddinAnalyticsAction = (typeof ODDIN_ANALYTICS_ACTIONS)[number]

export function safeJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/** Extract `route` from ROUTE_CHANGE payloads (shape varies by provider version). */
export function routeFromOddinEvent(ev: OddinIframeEvent): string | undefined {
  if (typeof ev.route === 'string' && ev.route.trim()) return ev.route.trim()
  const p = ev.payload
  if (typeof p === 'string' && p.trim()) return p.trim()
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const o = p as Record<string, unknown>
    const r = o.route ?? o.path ?? o.name
    if (typeof r === 'string' && r.trim()) return r.trim()
  }
  return undefined
}

export function analyticsActionFromPayload(payload: unknown): string | undefined {
  const o = safeJsonRecord(payload)
  const a = o.action ?? o.type ?? o.name
  return typeof a === 'string' && a.trim() ? a.trim() : undefined
}

export function isTrackedAnalyticsAction(action: string | undefined): action is OddinAnalyticsAction {
  if (!action) return false
  return (ODDIN_ANALYTICS_ACTIONS as readonly string[]).includes(action)
}
