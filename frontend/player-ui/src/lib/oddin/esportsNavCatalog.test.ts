import { describe, expect, it } from 'vitest'
import {
  mergeEsportsNavLogosFromFallback,
  normalizeEsportsNavPageKey,
} from './esportsNavCatalog'
import { applyEsportsBifrostRoutes } from './esportsOddinSportRoutes'

/** Long enough segments for `isOpaqueOddinBifrostRoute` (fake JWT shape). */
const fakeJwtRoute =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb3V0ZSI6Im15cm91dGUifQ.abcdefghijklmnopqrstuvwxyz12'

describe('applyEsportsBifrostRoutes', () => {
  it('maps legacy slash paths to od:sport URNs', () => {
    const out = applyEsportsBifrostRoutes({ id: 'lol', label: 'LoL', page: '/lol' })
    expect(out.page).toBe('od:sport:1')
  })

  it('keeps opaque JWT page from operator', () => {
    const out = applyEsportsBifrostRoutes({ id: 'lol', label: 'LoL', page: fakeJwtRoute })
    expect(out.page).toBe(fakeJwtRoute)
  })
})

describe('normalizeEsportsNavPageKey', () => {
  it('adds slash and lowercases path slugs', () => {
    expect(normalizeEsportsNavPageKey('/lol')).toBe('/lol')
    expect(normalizeEsportsNavPageKey('LOL')).toBe('/lol')
    expect(normalizeEsportsNavPageKey('cod')).toBe('/cod')
  })

  it('does not mutate JWT-style opaque routes', () => {
    expect(normalizeEsportsNavPageKey(fakeJwtRoute)).toBe(fakeJwtRoute)
  })

  it('normalizes Oddin sport URNs for lookup', () => {
    expect(normalizeEsportsNavPageKey('od:sport:1')).toBe('/od:sport:1')
  })

  it('returns empty for blank', () => {
    expect(normalizeEsportsNavPageKey('')).toBe('')
    expect(normalizeEsportsNavPageKey('  ')).toBe('')
  })
})

describe('mergeEsportsNavLogosFromFallback', () => {
  it('fills logo from page match only when missing', () => {
    const out = mergeEsportsNavLogosFromFallback([
      { id: 'x', label: 'Dota 2', page: '/dota2' },
      { id: 'y', label: 'Custom', page: '/dota2', logoUrl: 'https://cdn.oddin.example/dota.svg' },
    ])
    expect(out[0].logoUrl).toMatch(/dota2/)
    expect(out[1].logoUrl).toBe('https://cdn.oddin.example/dota.svg')
  })
})
