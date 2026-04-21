/** Broad regions for admin grouping (not UN M49). */
export type CountryRegion = 'Europe' | 'Americas' | 'Asia' | 'Oceania' | 'Africa' | 'Middle East'

export type CountryOption = { code: string; name: string; region: CountryRegion }

/** ISO 3166-1 alpha-2 for bonus segment.country_allow / country_deny (engine uses uppercase). */
export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'AD', name: 'Andorra', region: 'Europe' },
  { code: 'AE', name: 'United Arab Emirates', region: 'Middle East' },
  { code: 'AR', name: 'Argentina', region: 'Americas' },
  { code: 'AT', name: 'Austria', region: 'Europe' },
  { code: 'AU', name: 'Australia', region: 'Oceania' },
  { code: 'BE', name: 'Belgium', region: 'Europe' },
  { code: 'BG', name: 'Bulgaria', region: 'Europe' },
  { code: 'BR', name: 'Brazil', region: 'Americas' },
  { code: 'CA', name: 'Canada', region: 'Americas' },
  { code: 'CH', name: 'Switzerland', region: 'Europe' },
  { code: 'CL', name: 'Chile', region: 'Americas' },
  { code: 'CO', name: 'Colombia', region: 'Americas' },
  { code: 'CY', name: 'Cyprus', region: 'Europe' },
  { code: 'CZ', name: 'Czechia', region: 'Europe' },
  { code: 'DE', name: 'Germany', region: 'Europe' },
  { code: 'DK', name: 'Denmark', region: 'Europe' },
  { code: 'EE', name: 'Estonia', region: 'Europe' },
  { code: 'ES', name: 'Spain', region: 'Europe' },
  { code: 'FI', name: 'Finland', region: 'Europe' },
  { code: 'FR', name: 'France', region: 'Europe' },
  { code: 'GB', name: 'United Kingdom', region: 'Europe' },
  { code: 'GR', name: 'Greece', region: 'Europe' },
  { code: 'HR', name: 'Croatia', region: 'Europe' },
  { code: 'HU', name: 'Hungary', region: 'Europe' },
  { code: 'IE', name: 'Ireland', region: 'Europe' },
  { code: 'IN', name: 'India', region: 'Asia' },
  { code: 'IS', name: 'Iceland', region: 'Europe' },
  { code: 'IT', name: 'Italy', region: 'Europe' },
  { code: 'JP', name: 'Japan', region: 'Asia' },
  { code: 'LT', name: 'Lithuania', region: 'Europe' },
  { code: 'LU', name: 'Luxembourg', region: 'Europe' },
  { code: 'LV', name: 'Latvia', region: 'Europe' },
  { code: 'MT', name: 'Malta', region: 'Europe' },
  { code: 'MX', name: 'Mexico', region: 'Americas' },
  { code: 'NL', name: 'Netherlands', region: 'Europe' },
  { code: 'NO', name: 'Norway', region: 'Europe' },
  { code: 'NZ', name: 'New Zealand', region: 'Oceania' },
  { code: 'PE', name: 'Peru', region: 'Americas' },
  { code: 'PL', name: 'Poland', region: 'Europe' },
  { code: 'PT', name: 'Portugal', region: 'Europe' },
  { code: 'RO', name: 'Romania', region: 'Europe' },
  { code: 'SE', name: 'Sweden', region: 'Europe' },
  { code: 'SI', name: 'Slovenia', region: 'Europe' },
  { code: 'SK', name: 'Slovakia', region: 'Europe' },
  { code: 'US', name: 'United States', region: 'Americas' },
  { code: 'ZA', name: 'South Africa', region: 'Africa' },
]

const REGIONS_ORDER: CountryRegion[] = ['Europe', 'Americas', 'Asia', 'Middle East', 'Oceania', 'Africa']

export function countriesByRegion(): Map<CountryRegion, CountryOption[]> {
  const m = new Map<CountryRegion, CountryOption[]>()
  for (const r of REGIONS_ORDER) {
    m.set(r, [])
  }
  for (const c of COUNTRY_OPTIONS) {
    const list = m.get(c.region) ?? []
    list.push(c)
    m.set(c.region, list)
  }
  return m
}

/** Regional indicator flag emoji from ISO 3166-1 alpha-2. */
export function flagEmoji(iso2: string): string {
  const c = iso2.toUpperCase().replace(/[^A-Z]/g, '')
  if (c.length !== 2) return ''
  const A = 0x1f1e6
  return String.fromCodePoint(A + c.charCodeAt(0) - 65) + String.fromCodePoint(A + c.charCodeAt(1) - 65)
}
