/** Session flag: we already triggered one hard reload to recover from a missing lazy chunk. */
export const ADMIN_CHUNK_RECOVER_SESSION_KEY = 'admin_console_chunk_recover_v1'

/**
 * True when the failure is almost certainly a stale code-split chunk (e.g. after a new Vercel deploy).
 * The browser still runs an old entry while hashed asset names on the CDN no longer match.
 */
export function isStaleLazyChunkError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.message} ${(err as Error & { cause?: unknown }).cause ?? ''}`
      : String(err)
  const m = msg.toLowerCase()
  return (
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('error loading dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('chunk load error') ||
    (m.includes('loading chunk') && m.includes('failed'))
  )
}

export function scheduleClearChunkRecoverKey(ms = 5000): () => void {
  const id = window.setTimeout(() => {
    try {
      sessionStorage.removeItem(ADMIN_CHUNK_RECOVER_SESSION_KEY)
    } catch {
      /* ignore */
    }
  }, ms)
  return () => window.clearTimeout(id)
}
