/** Persisted UI locale for player-ui i18n (shell only; game titles stay API-sourced). */
export const PLAYER_UI_LOCALE_STORAGE_KEY = 'player_ui_locale'

export type PlayerUiLocale = 'en' | 'fr-CA'

export function readStoredPlayerLocale(): PlayerUiLocale | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(PLAYER_UI_LOCALE_STORAGE_KEY)
  return raw === 'fr-CA' || raw === 'en' ? raw : null
}

export function writeStoredPlayerLocale(lng: PlayerUiLocale) {
  localStorage.setItem(PLAYER_UI_LOCALE_STORAGE_KEY, lng)
}

export function applyLocaleToDocument(lng: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng
  }
}
