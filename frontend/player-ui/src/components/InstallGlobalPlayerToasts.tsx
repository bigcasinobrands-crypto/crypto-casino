import { useEffect } from 'react'

import { toastPlayerClientError, truncate } from '../notifications/playerToast'

/** Surfaces unexpected client errors as Sonner toasts (player app). */
export function InstallGlobalPlayerToasts() {
  useEffect(() => {
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason
      const msg =
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unknown rejection'
      toastPlayerClientError('unhandled_rejection', truncate(msg, 800))
    }
    const onWinError = (ev: ErrorEvent) => {
      const fn = ev.filename ?? ''
      if (fn.includes('chrome-extension://') || fn.includes('moz-extension://')) return
      toastPlayerClientError(
        'window_error',
        ev.message || 'Script error',
        import.meta.env.DEV ? `${ev.filename}:${ev.lineno}` : undefined,
      )
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    window.addEventListener('error', onWinError)
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled)
      window.removeEventListener('error', onWinError)
    }
  }, [])
  return null
}
