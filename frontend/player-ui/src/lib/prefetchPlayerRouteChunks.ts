/**
 * Warm Vite dynamic-import chunks after paint so Rewards / Profile / VIP / studios feel faster on first open.
 * Duplicate imports are deduped by the runtime module cache.
 */
export function schedulePlayerRouteChunkPrefetch(opts: { authenticated: boolean }): () => void {
  if (typeof window === 'undefined') return () => {}

  const loadSecondary = () => {
    void import('../pages/GameLobbyPage')
    void import('../pages/CasinoSportsPage')
    void import('../pages/StudiosPage')
    void import('../pages/LegalPage')
    void import('../pages/VerifyEmailPage')
    void import('../pages/BonusesPreviewPage')
    void import('../pages/DemoEmbedPage')
    if (opts.authenticated) {
      void import('../pages/BonusesPage')
      void import('../pages/ProfilePage')
      void import('../pages/VipPage')
      void import('../pages/WalletDepositPage')
    }
  }

  let idleId: number
  let scheduledWithIdleCallback = false
  if (typeof window.requestIdleCallback === 'function') {
    scheduledWithIdleCallback = true
    idleId = window.requestIdleCallback(loadSecondary, { timeout: 2500 })
  } else {
    idleId = window.setTimeout(loadSecondary, 300)
  }

  return () => {
    if (scheduledWithIdleCallback && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId)
    } else {
      window.clearTimeout(idleId)
    }
  }
}
