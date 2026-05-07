import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { playerFetch } from '../lib/playerFetch'
import {
  mergeOddinPublicConfigs,
  oddinIframeEnabled,
  oddinPublicConfigFromAPIPayload,
  readOddinPublicConfig,
  validateOddinPublicConfig,
  type OddinPublicConfig,
} from '../lib/oddin/oddin.config'

export type OddinBootstrapState = {
  /** True after the first GET /v1/sportsbook/oddin/public-config completes (any status). */
  bootstrapReady: boolean
  serverPublicConfig: OddinPublicConfig | null
  mergedPublicConfig: OddinPublicConfig | null
  oddinBifrostUsable: boolean
  esportsIntegrationActive: boolean
}

const defaultState: OddinBootstrapState = {
  bootstrapReady: false,
  serverPublicConfig: null,
  mergedPublicConfig: null,
  oddinBifrostUsable: false,
  esportsIntegrationActive: false,
}

const OddinBootstrapContext = createContext<OddinBootstrapState>(defaultState)

export function OddinBootstrapProvider({ children }: { children: ReactNode }) {
  const [serverPublicConfig, setServerPublicConfig] = useState<OddinPublicConfig | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await playerFetch('/v1/sportsbook/oddin/public-config')
        if (cancelled) return
        if (!res.ok) {
          setServerPublicConfig(null)
          return
        }
        const raw: unknown = await res.json().catch(() => null)
        if (cancelled) return
        setServerPublicConfig(oddinPublicConfigFromAPIPayload(raw))
      } catch {
        if (!cancelled) setServerPublicConfig(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo((): OddinBootstrapState => {
    const bootstrapReady = serverPublicConfig !== undefined
    const server = bootstrapReady ? (serverPublicConfig ?? null) : null
    const merged = mergeOddinPublicConfigs(readOddinPublicConfig(), server)
    const usable = merged ? validateOddinPublicConfig(merged).ok : false
    return {
      bootstrapReady,
      serverPublicConfig: bootstrapReady ? (serverPublicConfig ?? null) : null,
      mergedPublicConfig: merged,
      oddinBifrostUsable: usable,
      esportsIntegrationActive: oddinIframeEnabled() || usable,
    }
  }, [serverPublicConfig])

  return <OddinBootstrapContext.Provider value={value}>{children}</OddinBootstrapContext.Provider>
}

export function useOddinBootstrap(): OddinBootstrapState {
  return useContext(OddinBootstrapContext)
}
