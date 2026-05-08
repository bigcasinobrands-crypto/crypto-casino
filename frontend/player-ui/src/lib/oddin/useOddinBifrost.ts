import { useCallback, useEffect, useRef, useState } from 'react'
import { playerFetch } from '../playerFetch'
import type { OddinBifrostConfig, OddinBifrostInstance, OddinIframeEvent } from './oddin.types'
import { loadOddinScript } from './oddin-script-loader'
import type { OddinPublicConfig } from './oddin.config'
import { analyticsActionFromPayload, isTrackedAnalyticsAction, routeFromOddinEvent, safeJsonRecord } from './oddin-events'
import { bifrostHeightPx } from './oddin-layout'

export type OddinPhase = 'idle' | 'loading_script' | 'bootstrap' | 'ready' | 'error'

type Opts = {
  bifrostRoute?: string
  onOddinRoute?: (route: string) => void
  onLoaded?: () => void
  onError?: (message: string) => void
  userId?: string | null
  onRefreshBalance?: () => void | Promise<void>
  onRequestSignIn?: () => void
  onToggleFullscreen?: () => void
}

export function useOddinBifrost(
  publicConfig: OddinPublicConfig,
  sportsbookToken: string | null,
  bifrostRoute: string | undefined,
  opts: Opts,
) {
  const [phase, setPhase] = useState<OddinPhase>('idle')
  const [loadMessage, setLoadMessage] = useState<string | null>(null)
  const [iframeReady, setIframeReady] = useState(false)

  const instanceRef = useRef<OddinBifrostInstance | null>(null)
  const destroyedRef = useRef(false)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const tokenRef = useRef(sportsbookToken)
  tokenRef.current = sportsbookToken
  const routeRef = useRef(bifrostRoute)
  routeRef.current = bifrostRoute
  const cfgRef = useRef(publicConfig)
  cfgRef.current = publicConfig

  /** When bootstrap merges core `public-config` after first paint, rebuild Oddin's iframe so script/base/token/env stay in sync. */
  const bifrostConfigKey = [
    publicConfig.scriptUrl,
    publicConfig.baseUrl,
    publicConfig.brandToken,
    publicConfig.defaultLanguage,
    publicConfig.defaultCurrency,
    String(publicConfig.darkMode),
    publicConfig.theme ?? '',
    publicConfig.envLabel,
  ].join('\0')

  const postClientEvent = useCallback(async (eventType: string, extra: { action?: string; route?: string; payload?: Record<string, unknown> }) => {
    const uid = optsRef.current.userId
    try {
      await playerFetch('/v1/sportsbook/oddin/client-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: eventType,
          action: extra.action,
          route: extra.route,
          payload: {
            ...extra.payload,
            ...(uid ? { userId: uid } : {}),
            ts: new Date().toISOString(),
          },
        }),
      })
    } catch {
      /* non-fatal */
    }
  }, [])

  const handleIframeEvent = useCallback(
    (ev: OddinIframeEvent) => {
      const o = optsRef.current
      const t = typeof ev.type === 'string' ? ev.type : ''
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[oddin]', t, ev)
      }

      switch (t) {
        case 'LOADED':
          setIframeReady(true)
          setPhase('ready')
          setLoadMessage(null)
          o.onLoaded?.()
          void postClientEvent('LOADED', {})
          break
        case 'ERROR': {
          let msg = 'Sportsbook reported an error.'
          if (typeof ev.message === 'string' && ev.message.trim()) msg = ev.message
          else if (typeof ev.error === 'string' && ev.error.trim()) msg = ev.error
          else if (ev.error instanceof Error && ev.error.message) msg = ev.error.message
          setPhase('error')
          setLoadMessage(msg)
          o.onError?.(msg)
          void postClientEvent('ERROR', { payload: { message: msg } })
          break
        }
        case 'REQUEST_SIGN_IN':
          void postClientEvent('REQUEST_SIGN_IN', {})
          o.onRequestSignIn?.()
          break
        case 'REQUEST_REFRESH_BALANCE':
          void postClientEvent('REQUEST_REFRESH_BALANCE', {})
          void Promise.resolve(o.onRefreshBalance?.()).catch(() => {})
          break
        case 'ROUTE_CHANGE': {
          const route = routeFromOddinEvent(ev)
          if (route) o.onOddinRoute?.(route)
          void postClientEvent('ROUTE_CHANGE', { route })
          break
        }
        case 'ANALYTICS': {
          const payload = safeJsonRecord(ev.payload)
          const action = analyticsActionFromPayload(ev.payload)
          const tracked = isTrackedAnalyticsAction(action)
          if (import.meta.env.DEV || tracked) {
            // eslint-disable-next-line no-console
            console.info('[oddin analytics]', { action, payload, userId: o.userId, route: routeRef.current })
          }
          void postClientEvent('ANALYTICS', {
            action,
            route: routeRef.current,
            payload,
          })
          break
        }
        case 'TOGGLE_FULLSCREEN':
          void postClientEvent('TOGGLE_FULLSCREEN', { payload: safeJsonRecord(ev.payload) })
          o.onToggleFullscreen?.()
          break
        default:
          void postClientEvent(t || 'UNKNOWN', { payload: safeJsonRecord(ev.payload) })
      }
    },
    [postClientEvent],
  )

  useEffect(() => {
    destroyedRef.current = false
    let cancelled = false

    const run = async () => {
      setPhase('loading_script')
      setLoadMessage(null)
      setIframeReady(false)

      const loaded = await loadOddinScript(cfgRef.current.scriptUrl)
      if (cancelled || destroyedRef.current) return
      if (!loaded.ok) {
        setPhase('error')
        setLoadMessage(loaded.message)
        optsRef.current.onError?.(loaded.message)
        return
      }

      const w = window
      if (!w.oddin?.buildBifrost) {
        const msg = 'Oddin script loaded but buildBifrost is unavailable.'
        setPhase('error')
        setLoadMessage(msg)
        optsRef.current.onError?.(msg)
        return
      }

      setPhase('bootstrap')

      const cfg = cfgRef.current
      const baseConfig: OddinBifrostConfig = {
        token: tokenRef.current,
        brandToken: cfg.brandToken,
        baseUrl: cfg.baseUrl,
        language: cfg.defaultLanguage,
        currency: cfg.defaultCurrency,
        theme: cfg.theme,
        contentElement: '#bifrost',
        height: () => bifrostHeightPx(),
        darkMode: cfg.darkMode,
        route: routeRef.current,
        eventHandler: handleIframeEvent,
      }

      try {
        const inst = w.oddin.buildBifrost(baseConfig, true)
        instanceRef.current = inst
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not start Oddin esports iframe.'
        setPhase('error')
        setLoadMessage(msg)
        optsRef.current.onError?.(msg)
      }
    }

    void run().catch((e) => {
      if (cancelled || destroyedRef.current) return
      const msg = e instanceof Error ? e.message : 'Oddin initialization failed.'
      setPhase('error')
      setLoadMessage(msg)
      optsRef.current.onError?.(msg)
    })

    return () => {
      cancelled = true
      destroyedRef.current = true
      try {
        instanceRef.current?.destroy()
      } catch {
        /* ignore */
      }
      instanceRef.current = null
    }
  }, [handleIframeEvent, bifrostConfigKey])

  useEffect(() => {
    const inst = instanceRef.current
    if (!inst) return
    try {
      inst.updateConfig({ route: bifrostRoute })
    } catch {
      /* ignore */
    }
  }, [bifrostRoute])

  useEffect(() => {
    const inst = instanceRef.current
    if (!inst) return
    try {
      inst.refreshToken(sportsbookToken)
    } catch {
      /* ignore */
    }
  }, [sportsbookToken])

  return { phase, loadMessage, iframeReady, instanceRef }
}
