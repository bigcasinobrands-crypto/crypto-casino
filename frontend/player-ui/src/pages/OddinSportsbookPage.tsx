import { useEffect, useLayoutEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import OddinSportsbookFrame from '../components/sportsbook/OddinSportsbookFrame'
import SportsbookErrorState from '../components/sportsbook/SportsbookErrorState'
import SportsbookLoadingState from '../components/sportsbook/SportsbookLoadingState'
import {
  oddinIframeEnabled,
  readOddinPublicConfig,
  validateOddinPublicConfig,
  type OddinPublicConfig,
} from '../lib/oddin/oddin.config'
import { usePlayerAuth } from '../playerAuth'

export default function OddinSportsbookPage() {
  const cfg = readOddinPublicConfig()
  const valid = cfg ? validateOddinPublicConfig(cfg) : { ok: false as const, message: 'Oddin is not enabled.' }

  if (!oddinIframeEnabled() || !cfg) {
    return (
      <SportsbookErrorState
        title="Esports sportsbook"
        message="The Oddin Bifrost integration is disabled for this environment."
      >
        <Link to="/casino/sports" className="text-sm font-semibold text-casino-primary underline">
          Open legacy sportsbook
        </Link>
      </SportsbookErrorState>
    )
  }

  if (!valid.ok) {
    return (
      <SportsbookErrorState title="Sportsbook configuration" message={valid.message}>
        <p className="text-xs text-white/55">
          Set <span className="font-mono">VITE_ODDIN_*</span> in your player env (see <span className="font-mono">.env.example</span>).
        </p>
      </SportsbookErrorState>
    )
  }

  return <OddinSportsbookPageReady publicConfig={cfg} />
}

function OddinSportsbookPageReady({ publicConfig }: { publicConfig: OddinPublicConfig }) {
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)

  const currency = publicConfig.defaultCurrency
  const language = publicConfig.defaultLanguage

  useLayoutEffect(() => {
    if (!isAuthenticated) {
      setSessionToken(null)
      setSessionError(null)
      setPhase('ready')
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }
    let cancelled = false
    setPhase('loading')
    ;(async () => {
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
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch, currency, isAuthenticated, language])

  if (phase === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SportsbookLoadingState label={isAuthenticated ? 'Securing sportsbook session…' : 'Loading sportsbook…'} />
      </div>
    )
  }

  if (isAuthenticated && phase === 'error' && sessionError) {
    return <SportsbookErrorState title="Session error" message={sessionError} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <OddinSportsbookFrame publicConfig={publicConfig} sessionToken={isAuthenticated ? sessionToken : null} />
    </div>
  )
}
