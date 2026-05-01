import { COUNTRY_OPTIONS, flagEmoji, type CountryRegion } from './countryIsoList'

export function countrySelectOptions(): { value: string; label: string }[] {
  return COUNTRY_OPTIONS.map((c) => ({
    value: c.code,
    label: `${flagEmoji(c.code)} ${c.region} · ${c.name} (${c.code})`,
  }))
}

/** Add or remove all ISO codes in a region from a list (uppercase). */
export function toggleRegionCodes(region: CountryRegion, current: string[], add: boolean): string[] {
  const codes = new Set(current.map((x) => x.toUpperCase()))
  const inRegion = COUNTRY_OPTIONS.filter((c) => c.region === region).map((c) => c.code)
  for (const code of inRegion) {
    if (add) codes.add(code)
    else codes.delete(code)
  }
  return Array.from(codes)
}
