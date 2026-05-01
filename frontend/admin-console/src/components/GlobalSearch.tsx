import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import { ADMIN_NAV_SECTIONS } from '../layout/adminNavConfig'

type SearchCategory = 'Pages' | 'Players' | 'Transactions'

interface SearchResult {
  category: SearchCategory
  id: string
  label: string
  sublabel?: string
}

const CATEGORY_ORDER: SearchCategory[] = ['Pages', 'Players', 'Transactions']

function buildRouteIndex(): { path: string; label: string; section: string }[] {
  const out: { path: string; label: string; section: string }[] = []
  for (const sec of ADMIN_NAV_SECTIONS) {
    if (sec.path) out.push({ path: sec.path, label: sec.name, section: sec.name })
    for (const sub of sec.subItems ?? []) {
      out.push({ path: sub.path, label: sub.name, section: sec.name })
    }
  }
  return out
}

const ROUTE_INDEX = buildRouteIndex()

function matchRoutes(query: string): SearchResult[] {
  const t = query.trim().toLowerCase()
  const rows = ROUTE_INDEX.filter((r) => {
    if (!t) return true
    const pathNorm = r.path.toLowerCase()
    return (
      r.label.toLowerCase().includes(t) ||
      r.section.toLowerCase().includes(t) ||
      pathNorm.includes(t) ||
      pathNorm.replace(/^\//, '').includes(t.replace(/^\//, ''))
    )
  })
  return rows.slice(0, 20).map((r) => ({
    category: 'Pages',
    id: r.path,
    label: r.label,
    sublabel: `${r.section} · ${r.path}`,
  }))
}

function iconFor(cat: SearchCategory): string {
  if (cat === 'Players') return '👤'
  if (cat === 'Transactions') return '💳'
  return '🧭'
}

const GlobalSearch: FC = () => {
  const { apiFetch } = useAdminAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pageMatches, setPageMatches] = useState<SearchResult[]>([])
  const [apiResults, setApiResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const allResults = useMemo(() => [...pageMatches, ...apiResults], [pageMatches, apiResults])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
      setPageMatches(matchRoutes(''))
      setApiResults([])
      setSelectedIdx(0)
    } else {
      setQuery('')
      setPageMatches([])
      setApiResults([])
      setSelectedIdx(0)
    }
  }, [open])

  useEffect(() => {
    setSelectedIdx((i) => (allResults.length === 0 ? 0 : Math.min(i, allResults.length - 1)))
  }, [allResults.length])

  const runApiSearch = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setApiResults([])
        return
      }
      setLoading(true)
      try {
        const res = await apiFetch(`/v1/admin/search?q=${encodeURIComponent(q)}`)
        if (!res.ok) {
          setApiResults([])
          return
        }
        const json = (await res.json()) as {
          players?: { id: string; email?: string; username?: string; vip_tier?: string }[]
          transactions?: { id: string; type?: string; amount_minor?: number; status?: string }[]
        }
        const mapped: SearchResult[] = []
        for (const p of json.players ?? []) {
          const vipPart = p.vip_tier ? `VIP: ${p.vip_tier}` : ''
          const subParts = [vipPart, p.email].filter(Boolean)
          mapped.push({
            category: 'Players',
            id: p.id,
            label: p.username || p.email || p.id,
            sublabel: subParts.length > 0 ? subParts.join(' · ') : undefined,
          })
        }
        for (const t of json.transactions ?? []) {
          mapped.push({
            category: 'Transactions',
            id: t.id,
            label: `${t.type ?? 'txn'} — ${t.id.slice(0, 12)}`,
            sublabel: t.status,
          })
        }
        setApiResults(mapped)
      } finally {
        setLoading(false)
      }
    },
    [apiFetch],
  )

  const onInputChange = (val: string) => {
    setQuery(val)
    setPageMatches(matchRoutes(val))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const t = val.trim()
    if (t.length < 2) {
      setApiResults([])
      return
    }
    debounceRef.current = setTimeout(() => void runApiSearch(val), 300)
  }

  const select = (r: SearchResult) => {
    setOpen(false)
    if (r.category === 'Pages') {
      navigate(r.id)
      return
    }
    if (r.category === 'Players') {
      navigate(`/support/player/${r.id}`)
      return
    }
    navigate('/ledger')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (allResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && allResults[selectedIdx]) {
      e.preventDefault()
      select(allResults[selectedIdx])
    }
  }

  const sections = useMemo(() => {
    const m = new Map<SearchCategory, SearchResult[]>()
    for (const r of allResults) {
      const arr = m.get(r.category) ?? []
      arr.push(r)
      m.set(r.category, arr)
    }
    const out: { cat: SearchCategory; items: SearchResult[]; start: number }[] = []
    let start = 0
    for (const cat of CATEGORY_ORDER) {
      const items = m.get(cat)
      if (!items?.length) continue
      out.push({ cat, items, start })
      start += items.length
    }
    return out
  }, [allResults])

  if (!open) return null

  const noMatches = !loading && allResults.length === 0 && query.trim().length > 0

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
          <svg
            className="size-5 shrink-0 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, or search players (2+ chars)…"
            className="h-14 w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-gray-500"
          />
          <kbd className="hidden shrink-0 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500 sm:inline-block">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading && query.trim().length >= 2 ? (
            <div className="flex items-center justify-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden />
              <span className="text-secondary small">Searching players &amp; transactions…</span>
            </div>
          ) : null}

          {noMatches ? (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No pages or records match “{query.trim()}”.
            </p>
          ) : null}

          {allResults.length > 0 ? (
            <div className="py-2">
              {sections.map((sec) => (
                <div key={sec.cat}>
                  <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {sec.cat}
                  </p>
                  {sec.items.map((r, j) => {
                    const idx = sec.start + j
                    return (
                      <button
                        key={`${r.category}-${r.id}-${idx}`}
                        type="button"
                        onClick={() => select(r)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          selectedIdx === idx
                            ? 'bg-primary-subtle text-primary'
                            : 'text-body hover:bg-body-secondary'
                        }`}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs dark:bg-gray-800">
                          {iconFor(r.category)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{r.label}</p>
                          {r.sublabel && (
                            <p className="truncate text-xs text-gray-400 dark:text-gray-500">{r.sublabel}</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : null}

          {!loading && query.trim().length === 0 && allResults.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No navigation entries available.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-[10px] text-gray-400 dark:border-gray-700 dark:text-gray-500">
          <span>
            <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">↑↓</kbd> Navigate
            <span className="mx-2">·</span>
            <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">↵</kbd> Open
            <span className="mx-2">·</span>
            Pages filter live; players need 2+ characters
          </span>
          <span>
            <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  )
}

export default GlobalSearch
