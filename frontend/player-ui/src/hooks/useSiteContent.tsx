import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from 'react'
import { playerApiUrl } from '../lib/playerApiUrl'

type SiteContent = Record<string, any>

type SiteContentCtx = {
  content: SiteContent | null
  loading: boolean
  getContent: <T = any>(key: string, fallback?: T) => T
}

const CACHE_TTL_MS = 60_000

let moduleCache: { data: SiteContent; ts: number } | null = null

const Ctx = createContext<SiteContentCtx>({
  content: null,
  loading: true,
  getContent: (_k, fb) => fb as any,
})

export const SiteContentProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [content, setContent] = useState<SiteContent | null>(moduleCache?.data ?? null)
  const [loading, setLoading] = useState(moduleCache === null)
  const inflightRef = useRef(false)

  useEffect(() => {
    if (moduleCache && Date.now() - moduleCache.ts < CACHE_TTL_MS) {
      setContent(moduleCache.data)
      setLoading(false)
      return
    }
    if (inflightRef.current) return
    inflightRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(playerApiUrl('/v1/content/bundle'), {
          headers: { 'X-Request-Id': crypto.randomUUID() },
        })
        if (!res.ok) return
        const json = (await res.json()) as SiteContent
        moduleCache = { data: json, ts: Date.now() }
        if (!cancelled) setContent(json)
      } catch {
        // CMS unavailable — components fall back to hardcoded values
      } finally {
        if (!cancelled) setLoading(false)
        inflightRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const getContent = useCallback(
    <T = any,>(key: string, fallback?: T): T => {
      if (!content) return fallback as T
      const parts = key.split('.')
      let cur: any = content
      for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return fallback as T
        cur = cur[p]
      }
      return (cur ?? fallback) as T
    },
    [content],
  )

  return <Ctx.Provider value={{ content, loading, getContent }}>{children}</Ctx.Provider>
}

export function useSiteContent() {
  return useContext(Ctx)
}
