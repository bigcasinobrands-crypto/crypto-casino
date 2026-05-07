/**
 * Oddin Bifrost — reads public integration flags from Vite env (never secrets).
 * Mirrors backend `ODDIN_*` naming where applicable.
 */

export type OddinPublicConfig = {
  enabled: boolean
  envLabel: string
  brandToken: string
  baseUrl: string
  scriptUrl: string
  theme: string | undefined
  defaultLanguage: string
  defaultCurrency: string
  darkMode: boolean
}

function trim(v: string | undefined): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function oddinIframeEnabled(): boolean {
  const v = import.meta.env.VITE_ODDIN_ENABLED
  return v === 'true' || v === '1'
}

/** Sports lives at `/casino/sports`; Oddin vs coming-soon placeholder is decided by `CasinoSportsPage`. */
export function sportsbookPlayerPath(): string {
  return '/casino/sports'
}

export function readOddinPublicConfig(): OddinPublicConfig | null {
  if (!oddinIframeEnabled()) return null

  const brandToken = trim(import.meta.env.VITE_ODDIN_BRAND_TOKEN as string | undefined)
  const baseUrl = trim(import.meta.env.VITE_ODDIN_BASE_URL as string | undefined)
  const scriptUrl = trim(import.meta.env.VITE_ODDIN_SCRIPT_URL as string | undefined)
  const envLabel = trim(import.meta.env.VITE_ODDIN_ENV as string | undefined) || 'integration'
  const themeRaw = trim(import.meta.env.VITE_ODDIN_THEME as string | undefined)
  const defaultLanguage = trim(import.meta.env.VITE_ODDIN_DEFAULT_LANGUAGE as string | undefined) || 'en'
  const defaultCurrency = trim(import.meta.env.VITE_ODDIN_DEFAULT_CURRENCY as string | undefined) || 'USD'
  const darkRaw = import.meta.env.VITE_ODDIN_DARK_MODE as string | undefined

  return {
    enabled: true,
    envLabel,
    brandToken,
    baseUrl,
    scriptUrl,
    theme: themeRaw || undefined,
    defaultLanguage,
    defaultCurrency,
    darkMode: darkRaw === undefined || darkRaw === 'true' || darkRaw === '1',
  }
}

export function validateOddinPublicConfig(cfg: OddinPublicConfig): { ok: true } | { ok: false; message: string } {
  if (!cfg.brandToken) return { ok: false, message: 'Sportsbook brand token is not configured (VITE_ODDIN_BRAND_TOKEN).' }
  if (!cfg.scriptUrl) return { ok: false, message: 'Oddin script URL is not configured (VITE_ODDIN_SCRIPT_URL).' }
  if (!cfg.baseUrl) return { ok: false, message: 'Oddin base URL is not configured (VITE_ODDIN_BASE_URL).' }
  try {
    // eslint-disable-next-line no-new -- validate URL shape
    new URL(cfg.scriptUrl)
    new URL(cfg.baseUrl)
  } catch {
    return { ok: false, message: 'Oddin script URL or base URL is not a valid absolute URL.' }
  }
  return { ok: true }
}

/** Parses GET /v1/sportsbook/oddin/public-config JSON into {@link OddinPublicConfig} or null. */
export function oddinPublicConfigFromAPIPayload(data: unknown): OddinPublicConfig | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  const brandToken = typeof o.brand_token === 'string' ? o.brand_token.trim() : ''
  const baseUrl = typeof o.base_url === 'string' ? o.base_url.trim() : ''
  const scriptUrl = typeof o.script_url === 'string' ? o.script_url.trim() : ''
  const envLabel =
    typeof o.env === 'string' && o.env.trim() ? o.env.trim().toLowerCase() : 'integration'
  const themeRaw = typeof o.theme === 'string' ? o.theme.trim() : ''
  const defaultLanguage =
    typeof o.default_language === 'string' && o.default_language.trim() ? o.default_language.trim() : 'en'
  const defaultCurrency =
    typeof o.default_currency === 'string' && o.default_currency.trim()
      ? o.default_currency.trim().toUpperCase()
      : 'USD'
  const dr = o.dark_mode
  const darkMode =
    dr === undefined
      ? true
      : dr === true || dr === 1 || dr === '1' || dr === 'true' || dr === 'yes'

  const cfg: OddinPublicConfig = {
    enabled: true,
    envLabel,
    brandToken,
    baseUrl,
    scriptUrl,
    theme: themeRaw || undefined,
    defaultLanguage,
    defaultCurrency,
    darkMode,
  }
  if (!validateOddinPublicConfig(cfg).ok) return null
  return cfg
}

/** Prefer Vite non-empty fields; fill gaps from server public-config (core `ODDIN_*`). */
export function mergeOddinPublicConfigs(
  vite: OddinPublicConfig | null,
  server: OddinPublicConfig | null,
): OddinPublicConfig | null {
  if (!vite && !server) return null
  if (!vite) return server
  if (!server) return vite
  return {
    enabled: true,
    envLabel: vite.envLabel || server.envLabel,
    brandToken: vite.brandToken || server.brandToken,
    baseUrl: vite.baseUrl || server.baseUrl,
    scriptUrl: vite.scriptUrl || server.scriptUrl,
    theme: vite.theme ?? server.theme,
    defaultLanguage: vite.defaultLanguage || server.defaultLanguage,
    defaultCurrency: vite.defaultCurrency || server.defaultCurrency,
    darkMode: vite.darkMode ?? server.darkMode,
  }
}

/**
 * True when Bifrost should mount: feature flag on and all public fields validate.
 * If `VITE_ODDIN_ENABLED` is set but brand token or URLs are missing, returns false so the shell shows “coming soon” instead of a configuration error.
 */
export function oddinBifrostUsable(): boolean {
  if (!oddinIframeEnabled()) return false
  const cfg = readOddinPublicConfig()
  if (!cfg) return false
  return validateOddinPublicConfig(cfg).ok
}
