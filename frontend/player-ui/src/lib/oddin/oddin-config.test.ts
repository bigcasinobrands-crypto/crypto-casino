import { describe, expect, it } from 'vitest'
import {
  mergeOddinPublicConfigs,
  oddinPublicConfigFromAPIPayload,
  validateOddinPublicConfig,
  type OddinPublicConfig,
} from './oddin.config'

function baseCfg(over: Partial<OddinPublicConfig>): OddinPublicConfig {
  return {
    enabled: true,
    envLabel: 'integration',
    brandToken: 'brand',
    baseUrl: 'https://bifrost.integration.oddin.gg',
    scriptUrl: 'https://bifrost.integration.oddin.gg/script.js',
    theme: undefined,
    defaultLanguage: 'en',
    defaultCurrency: 'USD',
    darkMode: true,
    ...over,
  }
}

describe('validateOddinPublicConfig', () => {
  it('accepts a valid public config', () => {
    const r = validateOddinPublicConfig(baseCfg({}))
    expect(r.ok).toBe(true)
  })
  it('rejects empty brand token', () => {
    const r = validateOddinPublicConfig(baseCfg({ brandToken: '' }))
    expect(r.ok).toBe(false)
  })
  it('rejects invalid URLs', () => {
    const r = validateOddinPublicConfig(baseCfg({ baseUrl: 'not-a-url', scriptUrl: 'also-bad' }))
    expect(r.ok).toBe(false)
  })
})

describe('oddinPublicConfigFromAPIPayload', () => {
  it('parses valid API JSON', () => {
    const cfg = oddinPublicConfigFromAPIPayload({
      brand_token: 'bt',
      base_url: 'https://bifrost.integration.oddin.gg',
      script_url: 'https://bifrost.integration.oddin.gg/script.js',
      env: 'integration',
      default_language: 'en',
      default_currency: 'USD',
      dark_mode: true,
    })
    expect(cfg).not.toBeNull()
    expect(cfg?.brandToken).toBe('bt')
  })
  it('returns null on garbage', () => {
    expect(oddinPublicConfigFromAPIPayload(null)).toBeNull()
    expect(oddinPublicConfigFromAPIPayload({ brand_token: '' })).toBeNull()
  })
})

describe('mergeOddinPublicConfigs', () => {
  it('fills missing vite fields from server', () => {
    const vite = baseCfg({ brandToken: '', baseUrl: '', scriptUrl: '' })
    const server = baseCfg({ envLabel: 'production' })
    const m = mergeOddinPublicConfigs(vite, server)
    expect(m?.brandToken).toBe('brand')
    expect(validateOddinPublicConfig(m!).ok).toBe(true)
  })
})
