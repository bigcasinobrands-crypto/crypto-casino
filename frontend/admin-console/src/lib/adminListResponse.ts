/** Maps admin GET paths to the JSON array key in the response body. */
export const ADMIN_LIST_PATH_TO_KEY: Record<string, string> = {
  '/v1/admin/users': 'users',
  '/v1/admin/ledger': 'entries',
  '/v1/admin/events/blueocean': 'events',
  '/v1/admin/integrations/fystack/payments': 'payments',
  '/v1/admin/integrations/fystack/withdrawals': 'withdrawals',
  '/v1/admin/games': 'games',
  '/v1/admin/game-providers': 'providers',
  '/v1/admin/game-launches': 'launches',
  '/v1/admin/game-disputes': 'disputes',
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function isObjectArray(a: unknown): a is Record<string, unknown>[] {
  return (
    Array.isArray(a) &&
    a.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))
  )
}

/** Pulls the list rows from a successful admin list JSON body. */
export function extractAdminListRows(
  apiPath: string,
  data: unknown,
): Record<string, unknown>[] | null {
  if (!isRecord(data)) return null
  const pathKey = apiPath.split('?')[0] ?? apiPath
  const mapped = ADMIN_LIST_PATH_TO_KEY[pathKey]
  if (mapped) {
    const arr = data[mapped]
    // Go JSON encodes nil slices as null — treat as empty table instead of unexpected_shape.
    if (arr === null || arr === undefined) return []
    if (isObjectArray(arr)) return arr
    return null
  }
  for (const v of Object.values(data)) {
    if (isObjectArray(v)) return v
  }
  return null
}

/** Column order: stable keys from all rows (union). */
export function inferColumns(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) keys.add(k)
  }
  return [...keys].sort((a, b) => a.localeCompare(b))
}

export function formatAdminCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
