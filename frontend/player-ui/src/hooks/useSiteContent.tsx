import { createContext, useCallback, useContext, useEffect, useRef, useState, type FC, type ReactNode } from 'react'
import { playerApiUrl } from '../lib/playerApiUrl'

type SiteContent = Record<string, unknown>

/** Brief dwell after CMS settles — two rAFs already align paint; keep near-zero for fastest boot. */
const SHELL_READY_MIN_FROM_MOUNT_MS = 48

type SiteContentCtx = {
  content: SiteContent | null
  loading: boolean
  /** False until bundle work finished + min dwell + paint frames — use for full-screen boot chrome. */
  shellReady: boolean
  getContent: <T = unknown>(key: string, fallback?: T) => T
  /** Bypass in-memory TTL; use after CMS updates so VIP/marketing banners pick up saves without a full reload. */
  refreshSiteContent: () => Promise<void>
}

const CACHE_TTL_MS = 45_000
const PERSIST_KEY = 'player_site_content_cache_v1'

let moduleCache: { data: SiteContent; ts: number } | null = null

function readPersistedCache(): { data: SiteContent; ts: number } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data?: SiteContent; ts?: number }
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.data || typeof parsed.data !== 'object') return null
    if (typeof parsed.ts !== 'number' || !Number.isFinite(parsed.ts)) return null
    return { data: parsed.data, ts: parsed.ts }
  } catch {
    return null
  }
}

function writePersistedCache(value: { data: SiteContent; ts: number }) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(value))
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

const Ctx = createContext<SiteContentCtx>({
  content: null,
  loading: true,
  shellReady: false,
  getContent: <T,>(_k: string, fb?: T) => fb as T,
  refreshSiteContent: async () => {},
})

export const SiteContentProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const persisted = moduleCache ?? readPersistedCache()
  if (moduleCache == null && persisted) {
    moduleCache = persisted
  }
  const cacheAge = persisted ? Date.now() - persisted.ts : Number.POSITIVE_INFINITY
  const needsFetch =
    !persisted || !Number.isFinite(cacheAge) || cacheAge >= CACHE_TTL_MS
  const [content, setContent] = useState<SiteContent | null>(persisted?.data ?? null)
  const [loading, setLoading] = useState(needsFetch)
  const [shellReady, setShellReady] = useState(false)
  const shellMountAt = useRef(Date.now())

  const refreshSiteContent = useCallback(async () => {
    moduleCache = null
    setLoading(true)
    try {
      const res = await fetch(playerApiUrl('/v1/content/bundle'), {
        headers: { 'X-Request-Id': crypto.randomUUID() },
        cache: 'no-store',
      })
      if (!res.ok) return
      const json = (await res.json()) as SiteContent
      const next = { data: json, ts: Date.now() }
      moduleCache = next
      writePersistedCache(next)
      setContent(next.data)
    } catch {
      // CMS unavailable — keep previous content when possible
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (moduleCache && Date.now() - moduleCache.ts < CACHE_TTL_MS) {
      setContent(moduleCache.data)
      setLoading(false)
      return
    }
    void refreshSiteContent()
  }, [refreshSiteContent])

  useEffect(() => {
    if (loading) return
    const elapsed = Date.now() - shellMountAt.current
    const wait = Math.max(0, SHELL_READY_MIN_FROM_MOUNT_MS - elapsed)
    const t = window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setShellReady(true))
      })
    }, wait)
    return () => clearTimeout(t)
  }, [loading])

  const getContent = useCallback(
    <T = unknown,>(key: string, fallback?: T): T => {
      if (!content) return fallback as T
      const parts = key.split('.')
      let cur: unknown = content
      for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return fallback as T
        cur = (cur as Record<string, unknown>)[p]
      }
      return (cur ?? fallback) as T
    },
    [content],
  )

  return (
    <Ctx.Provider value={{ content, loading, shellReady, getContent, refreshSiteContent }}>{children}</Ctx.Provider>
  )
}

export function useSiteContent() {
  return useContext(Ctx)
}
