import { describe, expect, it } from 'vitest'
import {
  mergeEsportsNavLogosFromFallback,
  normalizeEsportsNavPageKey,
} from './esportsNavCatalog'

describe('normalizeEsportsNavPageKey', () => {
  it('adds slash and lowercases', () => {
    expect(normalizeEsportsNavPageKey('/lol')).toBe('/lol')
    expect(normalizeEsportsNavPageKey('LOL')).toBe('/lol')
    expect(normalizeEsportsNavPageKey('cod')).toBe('/cod')
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
