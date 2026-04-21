import { playerAppHref } from '@repo/cross-app'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { formatApiError, readApiError } from '../api/errors'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import { AreaChart, ChartCard, StatCard } from '../components/dashboard'
import { formatCompact, formatPct } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type VisibilityFilter = 'all' | 'visible' | 'hidden'

type Row = {
  id: string
  title: string
  provider: string
  category: string
  thumbnail_url?: string
  game_type?: string
  provider_system?: string
  hidden: boolean
  hidden_reason?: string
  bog_game_id?: number
  updated_at?: string
  provider_lobby_hidden?: boolean
  effective_in_lobby?: boolean
}

type ProviderRow = {
  provider: string
  game_count: number
  individually_visible_count: number
  lobby_hidden: boolean
  hidden_reason: string
  effective_lobby_visible_count: number
  settings_updated_at?: string
}

type SortKey = keyof Row
type SortDir = 'asc' | 'desc'

type GameRtpStats = {
  total_bets_minor?: number
  total_wins_minor?: number
  ggr_minor?: number
  rtp_pct?: number
  unique_players?: number
  total_sessions?: number
  rtp_by_day?: { date: string; bets_minor: number; wins_minor: number; rtp_pct: number }[]
}

type ConfirmState =
  | {
      kind: 'game'
      row: Row
      nextHidden: boolean
    }
  | {
      kind: 'provider'
      row: ProviderRow
      nextLobbyHidden: boolean
    }

const PAGE_SIZES = [25, 50, 100, 200] as const
const FETCH_LIMIT = 500

function isEffectiveInLobby(r: Row): boolean {
  if (typeof r.effective_in_lobby === 'boolean') return r.effective_in_lobby
  return !r.hidden && !r.provider_lobby_hidden
}

function boolSort(a: boolean, b: boolean) {
  return (a ? 1 : 0) - (b ? 1 : 0)
}

function sortRows(rows: Row[], key: SortKey | null, dir: SortDir): Row[] {
  if (!key) return rows
  const mul = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (key === 'bog_game_id') {
      return mul * (Number(a.bog_game_id ?? 0) - Number(b.bog_game_id ?? 0))
    }
    if (key === 'hidden') {
      return mul * boolSort(a.hidden, b.hidden)
    }
    if (key === 'provider_lobby_hidden') {
      return mul * boolSort(!!a.provider_lobby_hidden, !!b.provider_lobby_hidden)
    }
    if (key === 'effective_in_lobby') {
      return mul * boolSort(!!a.effective_in_lobby, !!b.effective_in_lobby)
    }
    const va = a[key]
    const vb = b[key]
    if (typeof va === 'boolean' && typeof vb === 'boolean') {
      return mul * boolSort(va, vb)
    }
    const sa = va == null ? '' : String(va)
    const sb = vb == null ? '' : String(vb)
    return mul * sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function Thumbnail({ url, title }: { url?: string; title: string }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <div
        className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-[10px] text-gray-500 dark:bg-white/10 dark:text-gray-400"
        title="No thumbnail"
      >
        —
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="size-11 shrink-0 rounded-lg object-cover ring-1 ring-gray-200 dark:ring-white/10"
      loading="lazy"
      onError={() => setBroken(true)}
      title={title}
    />
  )
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div className="relative z-[1] w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{message}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 dark:border-gray-600 dark:text-gray-200"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-500 hover:bg-brand-600'
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GamesCatalogPage() {
  const { apiFetch, role } = useAdminAuth()
  const { reportApiFailure } = useAdminActivityLog()
  const canManageLobby = role === 'superadmin'

  const [rows, setRows] = useState<Row[]>([])
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [provErr, setProvErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [provLoading, setProvLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<VisibilityFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const [rtpGame, setRtpGame] = useState<Row | null>(null)
  const [rtpData, setRtpData] = useState<GameRtpStats | null>(null)
  const [rtpLoading, setRtpLoading] = useState(false)
  const [rtpErr, setRtpErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const gamesPath = `/v1/admin/games?limit=${FETCH_LIMIT}`
    const res = await apiFetch(gamesPath)
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path: gamesPath })
      setErr(formatApiError(parsed, `HTTP ${res.status}`))
      setRows([])
      setLoading(false)
      return
    }
    const j = (await res.json()) as { games: Row[] }
    setRows(j.games ?? [])
    setLoading(false)
    setPage(1)
  }, [apiFetch, reportApiFailure])

  const loadRtpStats = useCallback(
    async (gameId: string) => {
      setRtpErr(null)
      setRtpLoading(true)
      setRtpData(null)
      try {
        const path = `/v1/admin/games/${encodeURIComponent(gameId)}/rtp-stats`
        const res = await apiFetch(path)
        if (!res.ok) {
          const parsed = await readApiError(res)
          reportApiFailure({ res, parsed, method: 'GET', path })
          setRtpErr(formatApiError(parsed, `HTTP ${res.status}`))
          return
        }
        setRtpData((await res.json()) as GameRtpStats)
      } catch {
        setRtpErr('Network error')
      } finally {
        setRtpLoading(false)
      }
    },
    [apiFetch, reportApiFailure],
  )

  const openRtpPanel = (row: Row) => {
    setRtpGame(row)
    void loadRtpStats(row.id)
  }

  const loadProviders = useCallback(async () => {
    setProvLoading(true)
    setProvErr(null)
    const provPath = '/v1/admin/game-providers'
    const res = await apiFetch(provPath)
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path: provPath })
      setProvErr(formatApiError(parsed, `HTTP ${res.status}`))
      setProviders([])
      setProvLoading(false)
      return
    }
    const j = (await res.json()) as { providers: ProviderRow[] }
    setProviders(j.providers ?? [])
    setProvLoading(false)
  }, [apiFetch, reportApiFailure])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadProviders()
    })
    return () => {
      cancelled = true
    }
  }, [loadProviders])

  const [launches24h, setLaunches24h] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/v1/admin/dashboard/kpis')
        if (cancelled || !res.ok) return
        const j = (await res.json()) as { game_launches_24h?: number }
        if (!cancelled && typeof j.game_launches_24h === 'number') {
          setLaunches24h(j.game_launches_24h)
        }
      } catch { /* stat card degrades gracefully */ }
    })()
    return () => { cancelled = true }
  }, [apiFetch])

  const stats = useMemo(() => {
    const total = rows.length
    const inLobby = rows.filter((r) => isEffectiveInLobby(r)).length
    const gameHidden = rows.filter((r) => r.hidden).length
    const blockedByProvider = rows.filter((r) => r.provider_lobby_hidden).length
    const providerKeys = new Set(rows.map((r) => r.provider).filter(Boolean)).size
    return { total, inLobby, gameHidden, blockedByProvider, providerKeys }
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      const eff = isEffectiveInLobby(r)
      if (visibility === 'visible' && !eff) return false
      if (visibility === 'hidden' && eff) return false
      if (!q) return true
      const bog = r.bog_game_id != null ? String(r.bog_game_id) : ''
      const hay = [r.id, r.title, r.provider, r.category, r.game_type, r.provider_system, bog]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query, visibility])

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'updated_at' ? 'desc' : 'asc')
    }
    setPage(1)
  }

  const runPatchGameHidden = async (id: string, hidden: boolean) => {
    const patchPath = `/v1/admin/games/${encodeURIComponent(id)}/hidden`
    const res = await apiFetch(patchPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden, reason: '' }),
    })
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'PATCH', path: patchPath })
      setErr(formatApiError(parsed, 'Update failed'))
      return
    }
    void load()
  }

  const runPatchProvider = async (provider: string, lobbyHidden: boolean) => {
    const lobbyPath = '/v1/admin/game-providers/lobby-hidden'
    const res = await apiFetch(lobbyPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, lobby_hidden: lobbyHidden, reason: '' }),
    })
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'PATCH', path: lobbyPath })
      setProvErr(formatApiError(parsed, 'Update failed'))
      return
    }
    void loadProviders()
    void load()
  }

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`inline-flex items-center gap-1 font-medium hover:text-brand-600 dark:hover:text-brand-400 ${
        sortKey === key ? 'text-brand-600 dark:text-brand-400' : ''
      }`}
      onClick={() => onSort(key)}
    >
      {label}
      {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  )

  const playerLobbyHref = (gameId: string) =>
    playerAppHref(import.meta.env, `/casino/game-lobby/${encodeURIComponent(gameId)}`)

  const confirmOpen = confirm !== null
  const confirmTitle =
    confirm?.kind === 'game'
      ? confirm.nextHidden
        ? 'Turn off this game?'
        : 'Turn this game back on?'
      : confirm?.nextLobbyHidden
        ? 'Turn off entire provider?'
        : 'Turn provider back on?'

  const confirmMessage =
    confirm?.kind === 'game'
      ? confirm.nextHidden
        ? `This removes “${confirm.row.title || confirm.row.id}” from the player lobby. Players will not see or launch it until you turn it on again.`
        : `Show “${confirm.row.title || confirm.row.id}” in the player lobby again (unless the whole provider is turned off or this row is still marked hidden).`
      : confirm
        ? confirm.nextLobbyHidden
          ? `This hides every game from provider “${confirm.row.provider}” in the player lobby at once (${confirm.row.game_count} games). Individually hidden games stay hidden when the provider is on again.`
          : `Re-enable provider “${confirm.row.provider}” in the lobby. Games you hid individually will remain hidden.`
        : ''

  const confirmLabel =
    confirm?.kind === 'game'
      ? confirm.nextHidden
        ? 'Yes, turn off game'
        : 'Yes, turn on game'
      : confirm?.nextLobbyHidden
        ? 'Yes, turn off provider'
        : 'Yes, turn on provider'

  const confirmDanger =
    confirm?.kind === 'game' ? confirm?.nextHidden : confirm?.nextLobbyHidden

  return (
    <>
      <PageMeta title="Games · Admin" description="Catalog, visibility, and monitoring" />
      <PageBreadcrumb pageTitle="Games" />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total games"
          value={loading ? '—' : formatCompact(stats.total)}
        />
        <StatCard
          label="Active providers"
          value={loading ? '—' : formatCompact(stats.providerKeys)}
        />
        <StatCard
          label="Launches 24h"
          value={launches24h != null ? formatCompact(launches24h) : '—'}
        />
      </div>

      <ComponentCard
        title="Providers"
        desc="GET /v1/admin/game-providers — turn a whole provider off in the player lobby (superadmin only). PATCH /v1/admin/game-providers/lobby-hidden"
      >
        {!canManageLobby ? (
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Lobby on/off controls require the <strong className="text-gray-900 dark:text-white">superadmin</strong>{' '}
            role. Your role: <span className="font-mono text-xs">{role ?? 'unknown'}</span>.
          </p>
        ) : null}
        {provErr ? (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">
            {provErr}{' '}
            <button type="button" className="underline" onClick={() => void loadProviders()}>
              Retry
            </button>
          </p>
        ) : null}
        {provLoading ? (
          <p className="text-sm text-gray-500">Loading providers…</p>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-[720px] divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Games</th>
                  <th className="px-3 py-2 font-medium">Not individually hidden</th>
                  <th className="px-3 py-2 font-medium">In player lobby now</th>
                  <th className="px-3 py-2 font-medium">Lobby status</th>
                  {canManageLobby ? <th className="px-3 py-2 font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {providers.map((p) => (
                  <tr key={p.provider || '—'}>
                    <td className="px-3 py-2 font-mono text-xs">{p.provider || '—'}</td>
                    <td className="px-3 py-2">{p.game_count}</td>
                    <td className="px-3 py-2">{p.individually_visible_count}</td>
                    <td className="px-3 py-2">{p.effective_lobby_visible_count}</td>
                    <td className="px-3 py-2 text-xs">
                      {p.lobby_hidden ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-800 dark:text-amber-200">
                          Off in lobby
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-800 dark:text-emerald-200">
                          On
                        </span>
                      )}
                    </td>
                    {canManageLobby ? (
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs text-brand-600 underline dark:text-brand-400"
                          onClick={() =>
                            setConfirm({
                              kind: 'provider',
                              row: p,
                              nextLobbyHidden: !p.lobby_hidden,
                            })
                          }
                        >
                          {p.lobby_hidden ? 'Turn on in lobby' : 'Turn off in lobby'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ComponentCard>

      <div className="h-6" />

      <ComponentCard
        title="Game management"
        desc={`GET /v1/admin/games — up to ${FETCH_LIMIT} rows. Per-game lobby toggle: superadmin only (PATCH /v1/admin/games/{id}/hidden).`}
      >
        {err ? (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">
            {err}{' '}
            <button type="button" className="underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : null}

        {!loading && rows.length > 0 ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="text-xs text-gray-500 dark:text-gray-400">In catalog</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stats.total}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="text-xs text-gray-500 dark:text-gray-400">In player lobby</p>
              <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                {stats.inLobby}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="text-xs text-gray-500 dark:text-gray-400">Hidden (game)</p>
              <p className="text-2xl font-semibold text-amber-600 dark:text-amber-400">
                {stats.gameHidden}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="text-xs text-gray-500 dark:text-gray-400">Rows under provider off</p>
              <p className="text-2xl font-semibold text-orange-600 dark:text-orange-400">
                {stats.blockedByProvider}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="text-xs text-gray-500 dark:text-gray-400">Provider keys</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                {stats.providerKeys}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="game-search" className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Search
            </label>
            <input
              id="game-search"
              type="search"
              placeholder="Title, id, provider, category, BOG id…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              className="w-full max-w-xl rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', 'visible', 'hidden'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVisibility(v)
                  setPage(1)
                }}
                className={`rounded-lg px-3 py-2 text-xs font-medium capitalize ${
                  visibility === v
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300'
                }`}
              >
                {v === 'all' ? 'All' : v === 'visible' ? 'In lobby' : 'Not in lobby'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Showing {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filtered.length)} of {filtered.length} matching
              {filtered.length !== rows.length ? ` (${rows.length} loaded)` : ''}
            </p>
            <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="min-w-[1040px] divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
                <thead className="bg-gray-50 dark:bg-gray-900/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">Thumb</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('title', 'Title')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('id', 'Game id')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('provider', 'Provider')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('category', 'Category')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('game_type', 'Type')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('bog_game_id', 'BOG id')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('updated_at', 'Updated')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('effective_in_lobby', 'Player lobby')}</th>
                    <th className="px-3 py-2 font-medium">RTP</th>
                    <th className="px-3 py-2 font-medium">Player</th>
                    {canManageLobby ? <th className="px-3 py-2 font-medium">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {pageRows.map((r) => (
                    <tr key={r.id} className="align-middle">
                      <td className="px-3 py-2">
                        <Thumbnail url={r.thumbnail_url} title={r.title} />
                      </td>
                      <td className="max-w-[14rem] px-3 py-2">
                        <span className="line-clamp-2 font-medium text-gray-900 dark:text-white">
                          {r.title || '—'}
                        </span>
                        {r.hidden_reason ? (
                          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" title={r.hidden_reason}>
                            {r.hidden_reason.length > 48
                              ? `${r.hidden_reason.slice(0, 48)}…`
                              : r.hidden_reason}
                          </p>
                        ) : null}
                      </td>
                      <td className="max-w-[8rem] px-3 py-2 font-mono text-xs break-all">{r.id}</td>
                      <td className="px-3 py-2 text-xs">{r.provider || '—'}</td>
                      <td className="px-3 py-2 text-xs">{r.category || '—'}</td>
                      <td className="max-w-[6rem] truncate px-3 py-2 text-xs" title={r.game_type}>
                        {r.game_type || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.bog_game_id ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                        {r.updated_at
                          ? new Date(r.updated_at).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isEffectiveInLobby(r) ? (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
                            Live
                          </span>
                        ) : r.provider_lobby_hidden ? (
                          <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-orange-800 dark:text-orange-200">
                            Provider off
                          </span>
                        ) : r.hidden ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                            Hidden
                          </span>
                        ) : (
                          <span className="rounded bg-gray-500/15 px-1.5 py-0.5 text-gray-700 dark:text-gray-300">
                            Off
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs text-brand-600 underline dark:text-brand-400"
                          onClick={() => openRtpPanel(r)}
                        >
                          Stats
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={playerLobbyHref(r.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-600 underline dark:text-brand-400"
                        >
                          Open
                        </a>
                      </td>
                      {canManageLobby ? (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="text-xs text-brand-600 underline dark:text-brand-400"
                            onClick={() =>
                              setConfirm({
                                kind: 'game',
                                row: r,
                                nextHidden: !r.hidden,
                              })
                            }
                          >
                            {r.hidden ? 'Turn on in lobby' : 'Turn off in lobby'}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageRows.length === 0 ? (
              <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No games match your filters.
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <span>Rows per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])
                    setPage(1)
                  }}
                  className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-gray-700"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-gray-700"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </ComponentCard>

      {rtpGame ? (
        <ComponentCard
          className="mt-6"
          title={`RTP & sessions · ${rtpGame.title || rtpGame.id}`}
          desc={`Game id ${rtpGame.id}. Based on ledger / launch aggregates in admin dashboard.`}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
              onClick={() => {
                setRtpGame(null)
                setRtpData(null)
                setRtpErr(null)
              }}
            >
              Close panel
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs text-white hover:bg-brand-600 disabled:opacity-50"
              disabled={rtpLoading}
              onClick={() => void loadRtpStats(rtpGame.id)}
            >
              {rtpLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {rtpErr ? <p className="text-sm text-red-600 dark:text-red-400">{rtpErr}</p> : null}
          {rtpData && !rtpLoading ? (
            <div className="space-y-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs text-gray-500">Observed RTP</dt>
                  <dd className="font-medium">{formatPct(rtpData.rtp_pct ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Unique players</dt>
                  <dd className="font-medium">{rtpData.unique_players ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Sessions</dt>
                  <dd className="font-medium">{rtpData.total_sessions ?? '—'}</dd>
                </div>
              </dl>
              {rtpData.rtp_by_day && rtpData.rtp_by_day.length > 0 ? (
                <ChartCard title="RTP by day">
                  <AreaChart
                    categories={rtpData.rtp_by_day.map((d) => d.date)}
                    series={[{ name: 'RTP %', data: rtpData.rtp_by_day.map((d) => d.rtp_pct), color: '#7C3AED' }]}
                    height={220}
                    yFormatter={(v) => `${v.toFixed(1)}%`}
                  />
                </ChartCard>
              ) : (
                <p className="text-sm text-gray-500">No daily RTP breakdown yet.</p>
              )}
            </div>
          ) : null}
        </ComponentCard>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        danger={!!confirmDanger}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === 'game') {
            void runPatchGameHidden(confirm.row.id, confirm.nextHidden)
          } else {
            void runPatchProvider(confirm.row.provider, confirm.nextLobbyHidden)
          }
          setConfirm(null)
        }}
      />
    </>
  )
}
