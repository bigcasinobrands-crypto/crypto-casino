import { createContext, useCallback, useContext, useEffect, useState, type FC, type ReactNode } from 'react'
import { playerApiUrl } from '../lib/playerApiUrl'

type SiteContent = Record<string, unknown>

type SiteContentCtx = {
  content: SiteContent | null
  loading: boolean
  getContent: <T = unknown>(key: string, fallback?: T) => T
  /** Bypass in-memory TTL; use after CMS updates so VIP/marketing banners pick up saves without a full reload. */
  refreshSiteContent: () => Promise<void>
}

const CACHE_TTL_MS = 45_000

let moduleCache: { data: SiteContent; ts: number } | null = null

const Ctx = createContext<SiteContentCtx>({
  content: null,
  loading: true,
  getContent: <T,>(_k: string, fb?: T) => fb as T,
  refreshSiteContent: async () => {},
})

export const SiteContentProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [content, setContent] = useState<SiteContent | null>(moduleCache?.data ?? null)
  const [loading, setLoading] = useState(moduleCache === null)

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
      moduleCache = { data: json, ts: Date.now() }
      setContent(json)
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

  return <Ctx.Provider value={{ content, loading, getContent, refreshSiteContent }}>{children}</Ctx.Provider>
}

export function useSiteContent() {
  return useContext(Ctx)
}
