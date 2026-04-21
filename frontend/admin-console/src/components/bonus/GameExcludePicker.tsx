import { useCallback, useEffect, useMemo, useState } from 'react'
import { readApiError, formatApiError } from '../../api/errors'

type GameRow = {
  id: string
  title: string
  provider: string
  effective_in_lobby?: boolean
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

type Props = {
  apiFetch: ApiFetch
  excludedIds: string[]
  onExcludedChange: (ids: string[]) => void
}

export default function GameExcludePicker({ apiFetch, excludedIds, onExcludedChange }: Props) {
  const [games, setGames] = useState<GameRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [prov, setProv] = useState('')

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/games?limit=500')
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Games load failed (${res.status})`))
        setGames([])
        return
      }
      const j = (await res.json()) as { games?: GameRow[] }
      setGames(Array.isArray(j.games) ? j.games : [])
    } catch {
      setErr('Network error loading games')
      setGames([])
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const providers = useMemo(() => {
    const s = new Set<string>()
    for (const g of games) {
      if (g.provider) s.add(g.provider)
    }
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [games])

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return games.filter((g) => {
      if (prov && g.provider !== prov) return false
      if (!qq) return true
      return (
        g.id.toLowerCase().includes(qq) ||
        g.title.toLowerCase().includes(qq) ||
        g.provider.toLowerCase().includes(qq)
      )
    })
  }, [games, q, prov])

  const set = useMemo(() => new Set(excludedIds.map((x) => x.toLowerCase())), [excludedIds])

  const toggle = (id: string) => {
    const k = id.trim().toLowerCase()
    if (!k) return
    const next = new Set(set)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onExcludedChange([...next])
  }

  const addAllFiltered = () => {
    const next = new Set(set)
    for (const g of filtered) next.add(g.id.trim().toLowerCase())
    onExcludedChange([...next])
  }

  const clearAll = () => onExcludedChange([])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={inputCls + ' max-w-xs'} value={prov} onChange={(e) => setProv(e.target.value)}>
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          className={inputCls + ' min-w-[180px] flex-1'}
          placeholder="Search game id or title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600" onClick={() => void load()}>
          Refresh catalog
        </button>
      </div>
      {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Excluded games do not contribute to wagering for this bonus. Uses catalog ids from Blue Ocean sync (
        <code className="rounded bg-gray-100 px-1 text-[11px] dark:bg-white/10">GET /v1/admin/games</code>).
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="text-sm text-brand-600 hover:underline dark:text-brand-400" onClick={addAllFiltered}>
          Add all filtered ({filtered.length})
        </button>
        <button type="button" className="text-sm text-gray-600 hover:underline dark:text-gray-400" onClick={clearAll}>
          Clear exclusions
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {filtered.slice(0, 200).map((g) => {
            const on = set.has(g.id.trim().toLowerCase())
            return (
              <li key={g.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                <input type="checkbox" checked={on} onChange={() => toggle(g.id)} className="rounded border-gray-300" />
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-gray-100">{g.title}</span>
                <span className="shrink-0 text-xs text-gray-500">{g.provider}</span>
                <code className="hidden max-w-[120px] shrink-0 truncate text-[11px] text-gray-500 sm:inline">{g.id}</code>
              </li>
            )
          })}
        </ul>
      </div>
      {excludedIds.length > 0 ? (
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {excludedIds.length} game(s) excluded. IDs:{' '}
          <span className="font-mono text-[11px]">{excludedIds.slice(0, 12).join(', ')}</span>
          {excludedIds.length > 12 ? '…' : ''}
        </p>
      ) : null}
    </div>
  )
}
