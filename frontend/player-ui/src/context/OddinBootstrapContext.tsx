import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { parsePlayerApiErrorCode, playerFetch } from '../lib/playerFetch'
import {
  mergeOddinPublicConfigs,
  oddinIframeEnabled,
  oddinPublicConfigFromAPIPayload,
  readOddinPublicConfig,
  validateOddinPublicConfig,
  type OddinPublicConfig,
} from '../lib/oddin/oddin.config'

/** Why Oddin public-config could not supply a merged Bifrost config (for operator-facing copy on `/casino/sports`). */
export type OddinPublicConfigHint =
  | null
  | 'oddin_disabled'
  | 'oddin_incomplete'
  | 'api_error'
  | 'invalid_payload'
  | 'network'

function mapPublicConfigFailureToHint(status: number, errorCode?: string): OddinPublicConfigHint {
  if (errorCode === 'oddin_incomplete') return 'oddin_incomplete'
  if (errorCode === 'oddin_disabled') return 'oddin_disabled'
  if (status === 404) return 'oddin_disabled'
  return 'api_error'
}

export type OddinBootstrapState = {
  /** True after the first GET /v1/sportsbook/oddin/public-config completes (any status). */
  bootstrapReady: boolean
  serverPublicConfig: OddinPublicConfig | null
  mergedPublicConfig: OddinPublicConfig | null
  oddinBifrostUsable: boolean
  esportsIntegrationActive: boolean
  /** Set when bootstrap finished but the API did not return a usable public config (or the request failed). */
  oddinPublicConfigHint: OddinPublicConfigHint
}

const defaultState: OddinBootstrapState = {
  bootstrapReady: false,
  serverPublicConfig: null,
  mergedPublicConfig: null,
  oddinBifrostUsable: false,
  esportsIntegrationActive: false,
  oddinPublicConfigHint: null,
}

const OddinBootstrapContext = createContext<OddinBootstrapState>(defaultState)

export function OddinBootstrapProvider({ children }: { children: ReactNode }) {
  const [serverPublicConfig, setServerPublicConfig] = useState<OddinPublicConfig | null | undefined>(undefined)
  const [publicConfigHint, setPublicConfigHint] = useState<OddinPublicConfigHint>(null)

  useEffect(() => {
    let cancelled = false
    setPublicConfigHint(null)
    ;(async () => {
      try {
        const res = await playerFetch('/v1/sportsbook/oddin/public-config')
        if (cancelled) return
        const text = await res.text()

        if (!res.ok) {
          const errorCode = parsePlayerApiErrorCode(text)
          if (cancelled) return
          setServerPublicConfig(null)
          setPublicConfigHint(mapPublicConfigFailureToHint(res.status, errorCode))
          return
        }

        let raw: unknown
        try {
          raw = JSON.parse(text)
        } catch {
          if (!cancelled) {
            setServerPublicConfig(null)
            setPublicConfigHint('invalid_payload')
          }
          return
        }
        if (cancelled) return
        const parsed = oddinPublicConfigFromAPIPayload(raw)
        if (!parsed) {
          setServerPublicConfig(null)
          setPublicConfigHint('invalid_payload')
          return
        }
        setPublicConfigHint(null)
        setServerPublicConfig(parsed)
      } catch {
        if (!cancelled) {
          setServerPublicConfig(null)
          setPublicConfigHint('network')
        }
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
      oddinPublicConfigHint: bootstrapReady ? publicConfigHint : null,
    }
  }, [serverPublicConfig, publicConfigHint])

  return <OddinBootstrapContext.Provider value={value}>{children}</OddinBootstrapContext.Provider>
}

export function useOddinBootstrap(): OddinBootstrapState {
  return useContext(OddinBootstrapContext)
}
