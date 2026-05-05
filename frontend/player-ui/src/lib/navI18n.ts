import type { TFunction } from 'i18next'
import type { CasinoNavCategory } from './casinoNav'

export type NavSection = 'casino' | 'promo' | 'extras'

export function translateNavItemLabel(
  t: TFunction,
  section: NavSection,
  item: CasinoNavCategory,
): string {
  return t(`nav.${section}.${item.id}`, { defaultValue: item.label })
}
