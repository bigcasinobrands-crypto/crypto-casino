import { playerApiUrl } from './playerApiUrl'

export function contentImageUrl(url?: string): string | undefined {
  const raw = url?.trim()
  if (!raw) return undefined

  // Blob URLs are session-scoped and never valid after reload.
  if (raw.startsWith('blob:')) return undefined

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      const pathWithQuery = `${parsed.pathname}${parsed.search || ''}`
      if (parsed.protocol === 'https:') return raw

      const isHttpsApp = typeof globalThis !== 'undefined' && globalThis.location?.protocol === 'https:'
      if (parsed.protocol === 'http:' && isHttpsApp && pathWithQuery.length > 1) {
        const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
        if (pathWithQuery.startsWith('/v1/') || (isLocal && pathWithQuery.startsWith('/'))) {
          return playerApiUrl(pathWithQuery)
        }
        if (pathWithQuery.startsWith('/uploads/')) {
          return playerApiUrl(`/v1${pathWithQuery}`)
        }
        if (!isLocal) {
          return `https://${parsed.host}${pathWithQuery}`
        }
      }
      return raw
    } catch {
      return raw
    }
  }

  if (raw.startsWith('//')) return raw
  if (raw.startsWith('/v1/')) return playerApiUrl(raw)
  if (raw.startsWith('v1/')) return playerApiUrl(`/${raw}`)
  if (raw.startsWith('/uploads/')) return playerApiUrl(`/v1${raw}`)
  if (raw.startsWith('uploads/')) return playerApiUrl(`/v1/${raw}`)
  return playerApiUrl(raw.startsWith('/') ? raw : `/${raw}`)
}
