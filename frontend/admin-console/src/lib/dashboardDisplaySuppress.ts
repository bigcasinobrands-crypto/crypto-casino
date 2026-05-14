/** Client-side companion to POST /v1/admin/analytics/reset-display-cache when Redis is unavailable. */
export const DASHBOARD_DISPLAY_SUPPRESS_CLIENT_KEY = 'admin_dashboard_display_suppress_client'

export function getClientDashboardSuppressFlag(): boolean {
  try {
    return sessionStorage.getItem(DASHBOARD_DISPLAY_SUPPRESS_CLIENT_KEY) === '1'
  } catch {
    return false
  }
}

export function setClientDashboardSuppressFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(DASHBOARD_DISPLAY_SUPPRESS_CLIENT_KEY, '1')
    else sessionStorage.removeItem(DASHBOARD_DISPLAY_SUPPRESS_CLIENT_KEY)
  } catch {
    /* ignore */
  }
}

/** Keys that may hold stale admin UI hints (not auth tokens). */
const LOCAL_KEYS_PREFIXES = ['admin_dashboard_', 'admin_analytics_', 'admin_finance_']

/** Persisted UI prefs we keep when clearing metric caches (not analytics values). */
const LOCAL_KEYS_NEVER_CLEAR = new Set(['admin_dashboard_show_test_exclusion_tip'])

export function clearLocalDashboardMetricHints() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (LOCAL_KEYS_NEVER_CLEAR.has(k)) continue
      if (LOCAL_KEYS_PREFIXES.some((p) => k.startsWith(p))) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}
