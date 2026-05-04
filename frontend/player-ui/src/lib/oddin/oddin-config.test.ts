import { describe, expect, it } from 'vitest'
import { validateOddinPublicConfig, type OddinPublicConfig } from './oddin.config'

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
