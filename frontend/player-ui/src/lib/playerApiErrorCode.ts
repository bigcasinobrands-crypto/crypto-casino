/** Extract `error.code` from core API JSON error bodies (`playerapi.WriteError`). */
export function parsePlayerApiErrorCodeFromBody(raw: string): string | undefined {
  try {
    const j = JSON.parse(raw) as { error?: { code?: unknown } }
    const c = j?.error?.code
    return typeof c === 'string' && c.trim() !== '' ? c.trim() : undefined
  } catch {
    return undefined
  }
}

export function parsePlayerApiErrorCodeFromValue(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const c = (parsed as { error?: { code?: unknown } }).error?.code
  return typeof c === 'string' && c.trim() !== '' ? c.trim() : undefined
}
