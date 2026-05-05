import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLAYER_UI_LOCALE_STORAGE_KEY,
  applyLocaleToDocument,
  readStoredPlayerLocale,
  writeStoredPlayerLocale,
} from './playerLocale'

let store: Record<string, string>

function mockStorage(): Storage {
  const api = {
    getItem: (k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      store = {}
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
  return api as Storage
}

describe('playerLocale', () => {
  beforeEach(() => {
    store = {}
    const ls = mockStorage()
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('window', { localStorage: ls } as Window)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('readStoredPlayerLocale returns null when unset', () => {
    expect(readStoredPlayerLocale()).toBeNull()
  })

  it('writeStoredPlayerLocale + readStoredPlayerLocale round-trip en', () => {
    writeStoredPlayerLocale('en')
    expect(localStorage.getItem(PLAYER_UI_LOCALE_STORAGE_KEY)).toBe('en')
    expect(readStoredPlayerLocale()).toBe('en')
  })

  it('writeStoredPlayerLocale + readStoredPlayerLocale round-trip fr-CA', () => {
    writeStoredPlayerLocale('fr-CA')
    expect(readStoredPlayerLocale()).toBe('fr-CA')
  })

  it('readStoredPlayerLocale ignores invalid stored values', () => {
    localStorage.setItem(PLAYER_UI_LOCALE_STORAGE_KEY, 'de')
    expect(readStoredPlayerLocale()).toBeNull()
  })

  it('applyLocaleToDocument sets documentElement.lang', () => {
    const html = { lang: 'en' }
    vi.stubGlobal('document', { documentElement: html } as Document)
    applyLocaleToDocument('fr-CA')
    expect(html.lang).toBe('fr-CA')
  })
})
