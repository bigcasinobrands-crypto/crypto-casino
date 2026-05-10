import { useEffect, useRef } from 'react'
import { usePlayerAuth } from '../playerAuth'
import { stashPendingReferralFromUrl } from '../lib/referralPendingStorage'

/**
 * Captures `?ref=` on first load:
 * - Stashes code in localStorage (required when API calls use `credentials: omit` — Set-Cookie from attribution is ignored cross-origin).
 * - POSTs attribution when possible (sets HttpOnly cookie for cookie-auth deployments).
 * - Strips `ref` from the URL via replaceState.
 */
export function useReferralAttributionCapture() {
  const { apiFetch } = usePlayerAuth()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || typeof window === 'undefined') return
    ran.current = true
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')?.trim()
    if (!ref) return

    stashPendingReferralFromUrl(ref)

    void (async () => {
      try {
        const res = await apiFetch('/v1/referrals/attribution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: ref }),
        })
        if (!res.ok) {
          /* Invalid / unknown code — leave URL cleanup so UX stays clean; stash already skipped invalid UX server-side on register */
        }
        params.delete('ref')
        const qs = params.toString()
        const path = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
        window.history.replaceState({}, '', path)
      } catch {
        params.delete('ref')
        const qs = params.toString()
        const path = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
        window.history.replaceState({}, '', path)
      }
    })()
  }, [apiFetch])
}
