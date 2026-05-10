import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'

export type CatalogSyncPhase = 'idle' | 'syncing' | 'success' | 'error'

type Ctx = {
  phase: CatalogSyncPhase
  /** Outcome or error line for the last completed run; cleared when a new sync starts. */
  lastMessage: string | null
  /** Bumps when a sync attempt finishes (success or failure) so pages can refetch status. */
  lastFinishedAt: number
  startCatalogSync: () => void
  clearCatalogSyncMessage: () => void
}

const BlueOceanCatalogSyncContext = createContext<Ctx | null>(null)

const SYNC_PATH = '/v1/admin/integrations/blueocean/sync-catalog'

export function BlueOceanCatalogSyncProvider({ children }: { children: ReactNode }) {
  const { apiFetch } = useAdminAuth()
  const { reportApiFailure, reportNetworkFailure } = useAdminActivityLog()
  const [phase, setPhase] = useState<CatalogSyncPhase>('idle')
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const [lastFinishedAt, setLastFinishedAt] = useState(0)
  const inFlightRef = useRef(false)

  const clearCatalogSyncMessage = useCallback(() => {
    setLastMessage(null)
    setPhase((p) => (p === 'success' || p === 'error' ? 'idle' : p))
  }, [])

  const startCatalogSync = useCallback(() => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setPhase('syncing')
    setLastMessage(null)

    void (async () => {
      try {
        const res = await apiFetch(SYNC_PATH, {
          method: 'POST',
          keepalive: true,
        })

        if (!res.ok) {
          const parsed = await readApiError(res)
          reportApiFailure({ res, parsed, method: 'POST', path: SYNC_PATH })
          const msg = `Sync failed (HTTP ${res.status}).`
          setPhase('error')
          setLastMessage(msg)
          toast.error(msg)
          setLastFinishedAt(Date.now())
          return
        }
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const okText = `Catalog sync OK: upserted ${String(j.upserted ?? '?')} game(s).`
        setPhase('success')
        setLastMessage(okText)
        toast.success('Catalog sync completed')
        setLastFinishedAt(Date.now())
      } catch {
        reportNetworkFailure({
          message: 'Network error during sync.',
          method: 'POST',
          path: SYNC_PATH,
        })
        const msg = 'Network error during sync.'
        setPhase('error')
        setLastMessage(msg)
        toast.error(msg)
        setLastFinishedAt(Date.now())
      } finally {
        inFlightRef.current = false
      }
    })()
  }, [apiFetch, reportApiFailure, reportNetworkFailure])

  const value = useMemo(
    () => ({
      phase,
      lastMessage,
      lastFinishedAt,
      startCatalogSync,
      clearCatalogSyncMessage,
    }),
    [phase, lastMessage, lastFinishedAt, startCatalogSync, clearCatalogSyncMessage],
  )

  return (
    <BlueOceanCatalogSyncContext.Provider value={value}>{children}</BlueOceanCatalogSyncContext.Provider>
  )
}

/** Context hook; colocated with provider (Fast Refresh allows components-only exports per file). */
// eslint-disable-next-line react-refresh/only-export-components -- standard provider + hook pattern
export function useBlueOceanCatalogSync(): Ctx {
  const v = useContext(BlueOceanCatalogSyncContext)
  if (!v) throw new Error('useBlueOceanCatalogSync must be used within BlueOceanCatalogSyncProvider')
  return v
}
