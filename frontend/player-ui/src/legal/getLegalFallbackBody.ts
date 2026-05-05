import { LEGAL_FALLBACK_BODIES_EN } from './legalFallbackBodies.en'
import { LEGAL_FALLBACK_BODIES_FR_CA } from './legalFallbackBodies.fr-CA'

/** HTML body when CMS has no `body` for this legal route — follows UI locale. */
export function getLegalFallbackBody(contentKey: string, lng: string | undefined): string {
  if (lng === 'fr-CA') {
    return LEGAL_FALLBACK_BODIES_FR_CA[contentKey] ?? LEGAL_FALLBACK_BODIES_EN[contentKey] ?? ''
  }
  return LEGAL_FALLBACK_BODIES_EN[contentKey] ?? ''
}
