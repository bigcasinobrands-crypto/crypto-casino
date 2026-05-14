import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAdminAuth } from '../authContext'
import {
  clearLocalDashboardMetricHints,
  getClientDashboardSuppressFlag,
  setClientDashboardSuppressFlag,
} from '../lib/dashboardDisplaySuppress'

type Ctx = {
  /** True when API is serving zeroed dashboard payloads (Redis) or browser fallback is on. */
  effectiveSuppressed: boolean
  serverSuppressed: boolean
  clientFallback: boolean
  syncFromServer: () => Promise<void>
  resetDisplayCache: () => Promise<{
    ok: boolean
    client_fallback?: boolean
    suppress_active?: boolean
  }>
  resumeDisplayCache: () => Promise<{ ok: boolean }>
}

const MetricsDisplaySuppressContext = createContext<Ctx | null>(null)

export function MetricsDisplaySuppressProvider({ children }: { children: ReactNode }) {
  const { apiFetch, accessToken } = useAdminAuth()
  const [serverSuppressed, setServerSuppressed] = useState(false)
  const [clientFallback, setClientFallback] = useState(getClientDashboardSuppressFlag)

  const syncFromServer = useCallback(async () => {
    if (!accessToken) {
      setServerSuppressed(false)
      return
    }
    try {
      const res = await apiFetch('/v1/admin/analytics/display-suppressed')
      if (!res.ok) return
      const j = (await res.json()) as { suppressed?: boolean; suppress_active?: boolean }
      const on = !!(j.suppress_active ?? j.suppressed)
      setServerSuppressed(on)
    } catch {
      /* ignore */
    }
  }, [apiFetch, accessToken])

  useEffect(() => {
    void syncFromServer()
  }, [syncFromServer])

  const resetDisplayCache = useCallback(async () => {
    clearLocalDashboardMetricHints()
    const res = await apiFetch('/v1/admin/analytics/reset-display-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: false }),
    })
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      client_fallback?: boolean
      suppress_active?: boolean
    }
    if (!res.ok) {
      return { ok: false, client_fallback: undefined }
    }
    if (j.client_fallback) {
      setClientDashboardSuppressFlag(true)
      setClientFallback(true)
    }
    await syncFromServer()
    try {
      window.dispatchEvent(new Event('admin-dashboard-display-suppress-changed'))
    } catch {
      /* ignore */
    }
    return { ok: j.ok !== false, client_fallback: j.client_fallback, suppress_active: j.suppress_active }
  }, [apiFetch, syncFromServer])

  const resumeDisplayCache = useCallback(async () => {
    setClientDashboardSuppressFlag(false)
    setClientFallback(false)
    const res = await apiFetch('/v1/admin/analytics/reset-display-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: true }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean }
    if (!res.ok) {
      return { ok: false }
    }
    await syncFromServer()
    try {
      window.dispatchEvent(new Event('admin-dashboard-display-suppress-changed'))
    } catch {
      /* ignore */
    }
    return { ok: j.ok !== false }
  }, [apiFetch, syncFromServer])

  const effectiveSuppressed = serverSuppressed || clientFallback

  const value = useMemo(
    () =>
      ({
        effectiveSuppressed,
        serverSuppressed,
        clientFallback,
        syncFromServer,
        resetDisplayCache,
        resumeDisplayCache,
      }) satisfies Ctx,
    [
      effectiveSuppressed,
      serverSuppressed,
      clientFallback,
      syncFromServer,
      resetDisplayCache,
      resumeDisplayCache,
    ],
  )

  return (
    <MetricsDisplaySuppressContext.Provider value={value}>{children}</MetricsDisplaySuppressContext.Provider>
  )
}

export function useMetricsDisplaySuppress(): Ctx {
  const v = useContext(MetricsDisplaySuppressContext)
  if (!v) {
    return {
      effectiveSuppressed: getClientDashboardSuppressFlag(),
      serverSuppressed: false,
      clientFallback: getClientDashboardSuppressFlag(),
      syncFromServer: async () => {},
      resetDisplayCache: async () => ({ ok: false }),
      resumeDisplayCache: async () => ({ ok: false }),
    }
  }
  return v
}
