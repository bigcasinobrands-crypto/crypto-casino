import { createContext, useContext, type ReactNode } from 'react'
import { useWalletDisplayFiat } from '../hooks/useWalletDisplayFiat'
import { usePlayerAuth } from '../playerAuth'

type WalletDisplayFiatValue = ReturnType<typeof useWalletDisplayFiat>

const Ctx = createContext<WalletDisplayFiatValue | null>(null)

/**
 * One wallet header is mounted per breakpoint (mobile / tablet / desktop). Without a shared
 * context each copy kept its own `displayFiat` + FX state, so changing EUR/USD/GBP on the visible
 * chip could disagree with hidden instances and confused refreshes.
 */
export function WalletDisplayFiatProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, playableBalanceCurrency } = usePlayerAuth()
  const settlementCcy = (playableBalanceCurrency || 'EUR').trim().toUpperCase() || 'EUR'
  const value = useWalletDisplayFiat(isAuthenticated ? settlementCcy : 'EUR')
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSharedWalletDisplayFiat(): WalletDisplayFiatValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error('useSharedWalletDisplayFiat must be used within WalletDisplayFiatProvider')
  }
  return v
}
