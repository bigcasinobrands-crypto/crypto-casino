import { useEffect, useRef } from 'react'
import { usePlayerAuth } from '../playerAuth'

/** Captures `?ref=` on first load, POSTs to set HttpOnly cookie, strips query via replaceState. */
export function useReferralAttributionCapture() {
  const { apiFetch } = usePlayerAuth()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || typeof window === 'undefined') return
    ran.current = true
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')?.trim()
    if (!ref) return

    void (async () => {
      try {
        const res = await apiFetch('/v1/referrals/attribution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: ref }),
        })
        if (!res.ok) return
        params.delete('ref')
        const qs = params.toString()
        const path = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
        window.history.replaceState({}, '', path)
      } catch {
        /* ignore */
      }
    })()
  }, [apiFetch])
}
