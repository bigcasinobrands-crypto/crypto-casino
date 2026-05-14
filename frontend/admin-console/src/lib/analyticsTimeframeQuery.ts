import type { TrafficPeriod } from '../hooks/useTrafficAnalytics'

export const TRAFFIC_PERIOD_VALUES: readonly TrafficPeriod[] = [
  '7d',
  '30d',
  '90d',
  '6m',
  'ytd',
  'all',
  'custom',
]

export function parseTrafficPeriodParam(raw: string | null): TrafficPeriod {
  if (raw && TRAFFIC_PERIOD_VALUES.includes(raw as TrafficPeriod)) {
    return raw as TrafficPeriod
  }
  return '30d'
}

/** Query string (no leading ?) for demographics / traffic analytics routes and cross-links. */
export function buildAnalyticsTimeframeSearch(
  period: string,
  customStart?: string,
  customEnd?: string,
): string {
  if (period === 'custom') {
    if (customStart && customEnd) {
      return [
        'period=custom',
        `start=${encodeURIComponent(customStart)}`,
        `end=${encodeURIComponent(customEnd)}`,
      ].join('&')
    }
    return 'period=custom'
  }
  return `period=${encodeURIComponent(period)}`
}
