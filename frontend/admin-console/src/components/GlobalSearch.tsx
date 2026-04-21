import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../authContext'

interface SearchResult {
  category: 'Players' | 'Transactions'
  id: string
  label: string
  sublabel?: string
}

const GlobalSearch: FC = () => {
  const { apiFetch } = useAdminAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
    } else {
      setQuery('')
      setResults([])
      setSelectedIdx(0)
    }
  }, [open])

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults([])
        return
      }
      setLoading(true)
      try {
        const res = await apiFetch(`/v1/admin/search?q=${encodeURIComponent(q)}`)
        if (!res.ok) {
          setResults([])
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
        setResults(mapped)
        setSelectedIdx(0)
      } finally {
        setLoading(false)
      }
    },
    [apiFetch],
  )

  const onInputChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void search(val), 300)
  }

  const select = (r: SearchResult) => {
    setOpen(false)
    if (r.category === 'Players') {
      navigate(`/support/player/${r.id}`)
    } else {
      navigate('/ledger')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault()
      select(results[selectedIdx])
    }
  }

  if (!open) return null

  const grouped = new Map<string, SearchResult[]>()
  for (const r of results) {
    const arr = grouped.get(r.category) ?? []
    arr.push(r)
    grouped.set(r.category, arr)
  }

  let flatIdx = 0

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
            placeholder="Search players, transactions..."
            className="h-14 w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-gray-500"
          />
          <kbd className="hidden shrink-0 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500 sm:inline-block">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
            </div>
          )}

          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No results for "{query}"
            </p>
          )}

          {!loading && results.length > 0 && (
            <div className="py-2">
              {[...grouped.entries()].map(([cat, items]) => (
                <div key={cat}>
                  <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {cat}
                  </p>
                  {items.map((r) => {
                    const idx = flatIdx++
                    return (
                      <button
                        key={`${r.category}-${r.id}`}
                        type="button"
                        onClick={() => select(r)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          selectedIdx === idx
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs dark:bg-gray-800">
                          {r.category === 'Players' ? '👤' : '💳'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{r.label}</p>
                          {r.sublabel && (
                            <p className="truncate text-xs text-gray-400 dark:text-gray-500">
                              {r.sublabel}
                            </p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {!loading && query.trim().length < 2 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              Type at least 2 characters to search
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-[10px] text-gray-400 dark:border-gray-700 dark:text-gray-500">
          <span>
            <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">↑↓</kbd> Navigate
            <span className="mx-2">·</span>
            <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">↵</kbd> Open
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
