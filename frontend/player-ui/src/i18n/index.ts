import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import frCA from '../locales/fr-CA.json'
import { applyLocaleToDocument, readStoredPlayerLocale, writeStoredPlayerLocale, type PlayerUiLocale } from '../lib/playerLocale'

const resources = {
  en: { translation: en },
  'fr-CA': { translation: frCA },
} as const

function initialLanguage(): string {
  return readStoredPlayerLocale() ?? 'en'
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

applyLocaleToDocument(i18n.language)

i18n.on('languageChanged', (lng) => {
  applyLocaleToDocument(lng)
})

export function changePlayerLocale(lng: PlayerUiLocale) {
  writeStoredPlayerLocale(lng)
  void i18n.changeLanguage(lng)
}

export default i18n
