import { useEffect, useLayoutEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import OddinSportsbookFrame from '../components/sportsbook/OddinSportsbookFrame'
import SportsbookErrorState from '../components/sportsbook/SportsbookErrorState'
import SportsbookLoadingState from '../components/sportsbook/SportsbookLoadingState'
import {
  oddinIframeEnabled,
  readOddinPublicConfig,
  sportsbookPlayerPath,
  validateOddinPublicConfig,
  type OddinPublicConfig,
} from '../lib/oddin/oddin.config'
import { usePlayerAuth } from '../playerAuth'

export default function OddinSportsbookPage({ publicConfig }: { publicConfig?: OddinPublicConfig }) {
  const cfg = publicConfig ?? readOddinPublicConfig()
  const valid = cfg ? validateOddinPublicConfig(cfg) : { ok: false as const, message: 'Oddin is not enabled.' }

  if (!cfg) {
    return (
      <SportsbookErrorState
        title="Esports sportsbook"
        message="Oddin esports is disabled for this environment."
      >
        <Link to={sportsbookPlayerPath()} className="text-sm font-semibold text-casino-primary underline">
          Open esports
        </Link>
      </SportsbookErrorState>
    )
  }

  if (!publicConfig && !oddinIframeEnabled()) {
    return (
      <SportsbookErrorState
        title="Esports sportsbook"
        message="Oddin esports is disabled for this environment."
      >
        <Link to={sportsbookPlayerPath()} className="text-sm font-semibold text-casino-primary underline">
          Open esports
        </Link>
      </SportsbookErrorState>
    )
  }

  if (!valid.ok) {
    return (
      <SportsbookErrorState title="Sportsbook configuration" message={valid.message}>
        <p className="text-xs text-white/55">
          Set Oddin on core (<span className="font-mono">ODDIN_ENABLED</span>, <span className="font-mono">ODDIN_BRAND_TOKEN</span>,{' '}
          <span className="font-mono">ODDIN_PUBLIC_BASE_URL</span>, <span className="font-mono">ODDIN_PUBLIC_SCRIPT_URL</span>) and/or{' '}
          <span className="font-mono">VITE_ODDIN_*</span> on the player (see <span className="font-mono">.env.example</span>).
        </p>
      </SportsbookErrorState>
    )
  }

  return <OddinSportsbookPageReady publicConfig={cfg} />
}

function OddinSportsbookPageReady({ publicConfig }: { publicConfig: OddinPublicConfig }) {
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const [searchParams] = useSearchParams()
  const allowGuestQuery =
    import.meta.env.DEV ||
    import.meta.env.VITE_ODDIN_ALLOW_GUEST_QUERY === '1' ||
    String(import.meta.env.VITE_ODDIN_ALLOW_GUEST_QUERY || '').toLowerCase() === 'true'
  const forceGuestIframe = allowGuestQuery && searchParams.get('oddin_guest') === '1'

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)

  const currency = publicConfig.defaultCurrency
  const language = publicConfig.defaultLanguage

  useLayoutEffect(() => {
    if (forceGuestIframe) {
      setSessionToken(null)
      setSessionError(null)
      setPhase('ready')
      return
    }
    if (!isAuthenticated) {
      setSessionToken(null)
      setSessionError(null)
      setPhase('ready')
    }
  }, [isAuthenticated, forceGuestIframe])

  useEffect(() => {
    if (forceGuestIframe || !isAuthenticated) {
      return
    }
    let cancelled = false
    setPhase('loading')
    ;(async () => {
      try {
        const res = await apiFetch('/v1/sportsbook/oddin/session-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currency, language }),
        })
        if (cancelled) return
        if (res.ok) {
          const j = (await res.json()) as { token?: string }
          setSessionToken(typeof j.token === 'string' ? j.token : null)
          setSessionError(null)
          setPhase('ready')
          return
        }
        setSessionToken(null)
        const err = await res.json().catch(() => null)
        const msg =
          err && typeof err === 'object' && 'message' in err && typeof (err as { message?: string }).message === 'string'
            ? (err as { message: string }).message
            : 'Could not issue sportsbook session.'
        setSessionError(msg)
        setPhase('error')
      } catch {
        if (cancelled) return
        setSessionToken(null)
        setSessionError('Could not reach the API for a sportsbook session.')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch, currency, forceGuestIframe, isAuthenticated, language])

  if (phase === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SportsbookLoadingState />
      </div>
    )
  }

  if (isAuthenticated && phase === 'error' && sessionError) {
    return <SportsbookErrorState title="Session error" message={sessionError} />
  }

  const iframeToken = forceGuestIframe ? null : isAuthenticated ? sessionToken : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {import.meta.env.DEV && forceGuestIframe ? (
        <div className="shrink-0 border-b border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-100/95">
          Oddin guest bisection: <span className="rounded bg-black/35 px-1 font-mono">?oddin_guest=1</span> — Oddin's client runs{' '}
          <strong>without</strong> a session token. Remove the query param to test real <code className="font-mono">userDetails</code>.
        </div>
      ) : null}
      <OddinSportsbookFrame publicConfig={publicConfig} sessionToken={iframeToken} />
    </div>
  )
}
