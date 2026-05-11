import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useOperationalHealth, type OperationalHealth } from '../hooks/useOperationalHealth'

export type OperationalHealthContextValue = {
  data: OperationalHealth | null
  ready: boolean
  /** Re-fetch `/health/operational` now (same logic as the background poll). */
  reload: () => Promise<void>
}

const OperationalHealthContext = createContext<OperationalHealthContextValue | null>(null)

export function OperationalHealthProvider({
  children,
  pollMs = 2000,
}: {
  children: ReactNode
  /** How often to poll `/health/operational` (maintenance/geo/kill-switch mirrors). */
  pollMs?: number
}) {
  const { data, ready, reload } = useOperationalHealth(pollMs)
  const value = useMemo(() => ({ data, ready, reload }), [data, ready, reload])
  return <OperationalHealthContext.Provider value={value}>{children}</OperationalHealthContext.Provider>
}

export function useSharedOperationalHealth(): OperationalHealthContextValue {
  const ctx = useContext(OperationalHealthContext)
  if (!ctx) {
    throw new Error('useSharedOperationalHealth must be used within OperationalHealthProvider')
  }
  return ctx
}
