import { useCallback, useEffect, useMemo, useState } from 'react'
import { readApiError, formatApiError } from '../../api/errors'
import { adminInputCls } from '../admin-ui/inputStyles'

type GameRow = {
  id: string
  title: string
  provider: string
  effective_in_lobby?: boolean
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

const inputCls = adminInputCls

export type GameCatalogPickerMode = 'exclude' | 'allow_only'

type Props = {
  apiFetch: ApiFetch
  /** Selected catalog game ids (excluded from WR, or allowed-only for WR). */
  selectedIds: string[]
  onChange: (ids: string[]) => void
  mode: GameCatalogPickerMode
}

export default function GameExcludePicker({ apiFetch, selectedIds, onChange, mode }: Props) {
  const [games, setGames] = useState<GameRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [prov, setProv] = useState('')

  const isExclude = mode === 'exclude'

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

  const set = useMemo(() => new Set(selectedIds.map((x) => x.toLowerCase())), [selectedIds])

  const toggle = (id: string) => {
    const k = id.trim().toLowerCase()
    if (!k) return
    const next = new Set(set)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onChange([...next])
  }

  const addAllFiltered = () => {
    const next = new Set(set)
    for (const g of filtered) next.add(g.id.trim().toLowerCase())
    onChange([...next])
  }

  const clearAll = () => onChange([])

  const panelClass = isExclude
    ? 'rounded-xl border border-amber-500/35 bg-amber-500/[0.06] dark:border-amber-500/30 dark:bg-amber-950/25'
    : 'rounded-xl border border-emerald-500/35 bg-emerald-500/[0.06] dark:border-emerald-500/30 dark:bg-emerald-950/25'

  const listBorderClass = isExclude
    ? 'border-amber-500/25 dark:border-amber-600/40'
    : 'border-emerald-500/25 dark:border-emerald-600/40'

  const badgeClass = isExclude
    ? 'bg-amber-500/20 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100'
    : 'bg-emerald-500/20 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100'

  return (
    <div className={`space-y-3 p-4 ${panelClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${badgeClass}`}>
          {isExclude ? 'Exclusion list' : 'Allow-only list'}
        </span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          Catalog ids from Blue Ocean sync —{' '}
          <code className="rounded bg-gray-100 px-1 text-[10px] dark:bg-white/10">GET /v1/admin/games</code>
        </span>
      </div>

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
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
          onClick={() => void load()}
        >
          Refresh catalog
        </button>
      </div>
      {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
        {isExclude ? (
          <>
            <strong className="text-gray-800 dark:text-gray-100">Excluded</strong> titles never count toward wagering for
            this bonus. Use this to block high-RTP or restricted games while the bonus is active.
          </>
        ) : (
          <>
            <strong className="text-gray-800 dark:text-gray-100">Allow-only</strong> mode: only checked titles advance the
            wagering bar; all other games do not count, even if they are not excluded above. Leave this list empty to
            permit any catalog game that is not excluded. If a game appears in <em>both</em> lists, the exclusion wins — it
            will not count.
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`text-sm font-semibold hover:underline ${isExclude ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}
          onClick={addAllFiltered}
        >
          {isExclude ? 'Add all filtered to exclusions' : 'Add all filtered to allowed list'} ({filtered.length})
        </button>
        <button type="button" className="text-sm text-gray-600 hover:underline dark:text-gray-400" onClick={clearAll}>
          {isExclude ? 'Clear exclusion list' : 'Clear allowed list'}
        </button>
      </div>
      <div className={`max-h-56 overflow-y-auto rounded-lg border bg-white/40 dark:bg-black/20 ${listBorderClass}`}>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {filtered.slice(0, 200).map((g) => {
            const on = set.has(g.id.trim().toLowerCase())
            return (
              <li key={g.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(g.id)}
                  className={`rounded border-gray-300 ${isExclude ? 'text-amber-600 focus:ring-amber-500' : 'text-emerald-600 focus:ring-emerald-500'}`}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-gray-100">{g.title}</span>
                <span className="shrink-0 text-xs text-gray-500">{g.provider}</span>
                <code className="hidden max-w-[120px] shrink-0 truncate text-[11px] text-gray-500 sm:inline">{g.id}</code>
              </li>
            )
          })}
        </ul>
      </div>
      {selectedIds.length > 0 ? (
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {isExclude ? (
            <>
              <strong>{selectedIds.length}</strong> game(s) excluded from wagering. Sample IDs:{' '}
            </>
          ) : (
            <>
              <strong>{selectedIds.length}</strong> game(s) in the allow-only list. Sample IDs:{' '}
            </>
          )}
          <span className="font-mono text-[11px]">{selectedIds.slice(0, 12).join(', ')}</span>
          {selectedIds.length > 12 ? '…' : ''}
        </p>
      ) : null}
    </div>
  )
}
