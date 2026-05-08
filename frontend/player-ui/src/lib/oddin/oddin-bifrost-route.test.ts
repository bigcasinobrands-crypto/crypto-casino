import { describe, expect, it } from 'vitest'
import {
  bifrostRoutesLooselyEqual,
  canonicalOddinBifrostPageQueryValue,
  normalizePageParam,
} from './oddin-bifrost-route'

const lolCsvEncoded =
  'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1RPT0ifQ%3D%3D'
const lolDecoded = decodeURIComponent(lolCsvEncoded)

describe('normalizePageParam', () => {
  it('decodes URL-encoded Oddin CSV tokens', () => {
    expect(normalizePageParam(lolCsvEncoded)).toBe(lolDecoded)
  })
})

describe('canonicalOddinBifrostPageQueryValue', () => {
  it('matches bundled nav page strings after ROUTE_CHANGE', () => {
    expect(canonicalOddinBifrostPageQueryValue(lolCsvEncoded)).toBe(lolDecoded)
  })
})

describe('bifrostRoutesLooselyEqual', () => {
  it('treats encoded and decoded CSV params as the same sport', () => {
    expect(bifrostRoutesLooselyEqual(lolCsvEncoded, lolDecoded)).toBe(true)
    expect(bifrostRoutesLooselyEqual(lolDecoded, lolCsvEncoded)).toBe(true)
  })

  it('matches on inner sportId for identical outer encodings', () => {
    expect(bifrostRoutesLooselyEqual(lolDecoded, lolDecoded)).toBe(true)
  })

  it('does not equate different sports', () => {
    const dotaDecoded = decodeURIComponent(
      'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1nPT0ifQ%3D%3D',
    )
    expect(bifrostRoutesLooselyEqual(lolDecoded, dotaDecoded)).toBe(false)
  })
})
