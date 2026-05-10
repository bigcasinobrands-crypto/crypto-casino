import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useOperationalHealth, type OperationalHealth } from '../hooks/useOperationalHealth'

export type OperationalHealthContextValue = {
  data: OperationalHealth | null
  ready: boolean
}

const OperationalHealthContext = createContext<OperationalHealthContextValue | null>(null)

export function OperationalHealthProvider({
  children,
  pollMs = 45_000,
}: {
  children: ReactNode
  /** Align with {@link SiteAccessGate} refresh cadence. */
  pollMs?: number
}) {
  const { data, ready } = useOperationalHealth(pollMs)
  const value = useMemo(() => ({ data, ready }), [data, ready])
  return <OperationalHealthContext.Provider value={value}>{children}</OperationalHealthContext.Provider>
}

export function useSharedOperationalHealth(): OperationalHealthContextValue {
  const ctx = useContext(OperationalHealthContext)
  if (!ctx) {
    throw new Error('useSharedOperationalHealth must be used within OperationalHealthProvider')
  }
  return ctx
}
