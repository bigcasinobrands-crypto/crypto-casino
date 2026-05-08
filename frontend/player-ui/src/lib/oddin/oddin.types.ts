/**
 * Types for Oddin.gg `buildBifrost` (their iframe SDK) — public config only on the client.
 */

export type OddinBifrostConfig = {
  token?: string | null
  brandToken?: string
  baseUrl?: string
  language?: string
  currency?: string
  theme?: string
  contentElement: string
  height?: string | (() => number)
  customDomain?: string
  eventHandler?: (ev: OddinIframeEvent) => void
  banners?: unknown
  oddsFormat?: string
  supportedOddsFormats?: string[]
  darkMode?: boolean
  route?: string
}

export type OddinBifrostInstance = {
  updateConfig: (cfg: Partial<OddinBifrostConfig>) => void
  refreshToken: (token: string | null) => void
  destroy: () => void
}

export type OddinIframeEventType =
  | 'LOADED'
  | 'ERROR'
  | 'REQUEST_SIGN_IN'
  | 'REQUEST_REFRESH_BALANCE'
  | 'ROUTE_CHANGE'
  | 'ANALYTICS'
  | 'TOGGLE_FULLSCREEN'

export type OddinIframeEvent = {
  type: OddinIframeEventType | (string & {})
  route?: string
  payload?: unknown
  message?: string
  error?: unknown
}

declare global {
  interface Window {
    oddin?: {
      buildBifrost: (config: OddinBifrostConfig, singleInstance?: boolean) => OddinBifrostInstance
      instance?: OddinBifrostInstance
    }
  }
}

export {}
