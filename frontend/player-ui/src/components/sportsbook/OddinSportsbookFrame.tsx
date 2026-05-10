import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthModal } from '../../authModalContext'
import type { OddinPublicConfig } from '../../lib/oddin/oddin.config'
import { bifrostContentHeightPx } from '../../lib/oddin/oddin-layout'
import { canonicalOddinBifrostPageQueryValue } from '../../lib/oddin/oddin-bifrost-route'
import { useOddinBifrost } from '../../lib/oddin/useOddinBifrost'
import { usePlayerAuth } from '../../playerAuth'
import SportsbookErrorState from './SportsbookErrorState'
import SportsbookLoadingState from './SportsbookLoadingState'

type OddinSportsbookFrameProps = {
  publicConfig: OddinPublicConfig
  /** Resolved opaque token when logged in; null when logged out or browse-only. */
  sessionToken: string | null
}

export default function OddinSportsbookFrame({ publicConfig, sessionToken }: OddinSportsbookFrameProps) {
  const { refreshProfile, me } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const [searchParams, setSearchParams] = useSearchParams()

  const pageRoute = searchParams.get('page')?.trim() || undefined

  const onOddinRoute = useCallback(
    (route: string) => {
      const canonical = canonicalOddinBifrostPageQueryValue(route)
      const next = new URLSearchParams(searchParams)
      if (!canonical) {
        next.delete('page')
      } else {
        next.set('page', canonical)
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const [shellError, setShellError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const { phase, loadMessage, iframeReady, instanceRef } = useOddinBifrost(
    publicConfig,
    sessionToken,
    pageRoute,
    {
      onOddinRoute,
      userId: me?.id,
      onRefreshBalance: () => void refreshProfile(),
      onRequestSignIn: () => openAuth('login'),
      onError: (m) => setShellError(m),
      onToggleFullscreen: () => setFullscreen((f) => !f),
    },
  )

  // Viewport changes + real `#bifrost` host size (banners, safe areas, tablet bottom bar).
  useEffect(() => {
    if (phase === 'idle' || phase === 'loading_script') return
    const inst = instanceRef.current
    if (!inst) return
    const bump = () => {
      try {
        inst.updateConfig({
          height: () => bifrostContentHeightPx(),
        })
      } catch {
        /* ignore */
      }
    }
    bump()
    window.addEventListener('resize', bump)
    const el = typeof document !== 'undefined' ? document.getElementById('bifrost') : null
    let ro: ResizeObserver | null = null
    if (el instanceof HTMLElement) {
      ro = new ResizeObserver(() => bump())
      ro.observe(el)
    }
    return () => {
      window.removeEventListener('resize', bump)
      ro?.disconnect()
    }
  }, [phase, instanceRef])

  const showLoader = phase === 'loading_script' || phase === 'bootstrap' || (phase === 'ready' && !iframeReady)
  const errMsg = shellError || loadMessage

  if (phase === 'error') {
    return <SportsbookErrorState message={errMsg || 'The sportsbook failed to load.'} />
  }

  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-casino-bg ${
        fullscreen ? 'fixed inset-0 z-[320] min-h-0' : ''
      }`}
    >
      {showLoader ? (
        <div className="absolute inset-0 z-[1] flex min-h-0 min-w-0 bg-casino-bg/90 backdrop-blur-[2px]">
          <SportsbookLoadingState />
        </div>
      ) : null}

      <div
        id="bifrost"
        className="relative isolate min-h-0 flex-1 w-full min-w-0 overflow-hidden overscroll-none touch-manipulation select-none [&_iframe]:block [&_iframe]:h-full [&_iframe]:max-h-full [&_iframe]:min-h-0 [&_iframe]:w-full [&_iframe]:max-w-full [&_iframe]:touch-manipulation [&_iframe]:border-0"
      />
    </div>
  )
}
