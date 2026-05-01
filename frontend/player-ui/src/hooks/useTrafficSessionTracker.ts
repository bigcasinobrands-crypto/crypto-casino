import { useEffect, useRef } from 'react'
import { playerFetch } from '../lib/playerFetch'

const STORAGE_KEY = 'crypto_traffic_session_key'

function browserSessionKey(): string {
  let k = sessionStorage.getItem(STORAGE_KEY)
  if (!k) {
    k = crypto.randomUUID()
    sessionStorage.setItem(STORAGE_KEY, k)
  }
  return k
}

function inferDevice(): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobi/i.test(ua))) return 'tablet'
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile'
  return 'desktop'
}

function utmFromSearch(search: string) {
  const q = search.startsWith('?') ? search.slice(1) : search
  const sp = new URLSearchParams(q)
  return {
    utm_source: sp.get('utm_source') ?? '',
    utm_medium: sp.get('utm_medium') ?? '',
    utm_campaign: sp.get('utm_campaign') ?? '',
    utm_content: sp.get('utm_content') ?? '',
    utm_term: sp.get('utm_term') ?? '',
  }
}

/**
 * Records lobby navigation for admin Demographics & Traffic (POST /v1/analytics/session).
 */
export function useTrafficSessionTracker(
  pathname: string,
  search: string,
  accessToken: string | null,
  isAuthenticated: boolean,
) {
  const lastSent = useRef<string>('')

  useEffect(() => {
    const pathWithSearch = `${pathname}${search}`
    if (pathWithSearch === lastSent.current) return
    lastSent.current = pathWithSearch

    const utm = utmFromSearch(search)
    const body = {
      session_key: browserSessionKey(),
      path: pathWithSearch,
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      device_type: inferDevice(),
      ...utm,
    }

    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`

    void playerFetch('/v1/analytics/session', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* non-blocking */
    })
  }, [pathname, search, accessToken, isAuthenticated])
}
