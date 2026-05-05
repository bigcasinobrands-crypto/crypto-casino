import { LEGAL_AML_FR_CA } from './fr-CA/bodies/aml'
import { LEGAL_PRIVACY_FR_CA } from './fr-CA/bodies/privacy'
import { LEGAL_RESPONSIBLE_FR_CA } from './fr-CA/bodies/responsible'
import { LEGAL_TERMS_FR_CA } from './fr-CA/bodies/terms'

/** CMS fallback HTML when site content has no body — Canadian French. */
export const LEGAL_FALLBACK_BODIES_FR_CA: Record<string, string> = {
  'legal.terms_of_service': LEGAL_TERMS_FR_CA,
  'legal.privacy_policy': LEGAL_PRIVACY_FR_CA,
  'legal.responsible_gambling': LEGAL_RESPONSIBLE_FR_CA,
  'legal.fairness': LEGAL_AML_FR_CA,
}
