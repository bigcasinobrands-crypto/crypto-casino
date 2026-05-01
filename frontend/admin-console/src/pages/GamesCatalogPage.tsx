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
  /** Effective image (override if set, else catalog from Blue Ocean / snapshot). */
  thumbnail_url?: string
  /** Catalog feed only (not shown to players when override is set). */
  thumbnail_url_catalog?: string
  /** Staff override URL; empty when using catalog. */
  thumbnail_url_override?: string
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
  const [studioCount, setStudioCount] = useState<number | null>(null)
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
  const [thumbModal, setThumbModal] = useState<Row | null>(null)
  const [thumbDraft, setThumbDraft] = useState('')

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
      setStudioCount(null)
      setProvLoading(false)
      return
    }
    const j = (await res.json()) as { providers: ProviderRow[]; studio_count?: number }
    setProviders(j.providers ?? [])
    setStudioCount(typeof j.studio_count === 'number' ? j.studio_count : null)
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

  /** Full-catalog aggregates from /v1/admin/game-providers (not capped by the games list limit). */
  const catalogStats = useMemo(() => {
    const totalGames = providers.reduce((s, p) => s + p.game_count, 0)
    const inLobby = providers.reduce((s, p) => s + p.effective_lobby_visible_count, 0)
    const hiddenGames = providers.reduce(
      (s, p) => s + Math.max(0, p.game_count - p.individually_visible_count),
      0,
    )
    const integrationLobbyOffGames = providers.reduce(
      (s, p) => s + (p.lobby_hidden ? p.game_count : 0),
      0,
    )
    const integrationCount = providers.length
    return {
      totalGames,
      inLobby,
      hiddenGames,
      integrationLobbyOffGames,
      integrationCount,
      studioCount,
    }
  }, [providers, studioCount])

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

  const runPatchThumbnail = async () => {
    if (!thumbModal) return
    const patchPath = `/v1/admin/games/${encodeURIComponent(thumbModal.id)}/thumbnail-override`
    const trimmed = thumbDraft.trim()
    const body =
      trimmed.length > 0
        ? { thumbnail_url_override: trimmed }
        : { clear_thumbnail_override: true }
    const res = await apiFetch(patchPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'PATCH', path: patchPath })
      setErr(formatApiError(parsed, 'Thumbnail update failed'))
      return
    }
    setThumbModal(null)
    void load()
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
      className={`btn btn-link btn-sm text-decoration-none p-0 text-body fw-semibold ${
        sortKey === key ? 'link-primary' : ''
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
        ? 'Turn off entire catalog integration?'
        : 'Turn integration back on in the lobby?'

  const confirmMessage =
    confirm?.kind === 'game'
      ? confirm.nextHidden
        ? `This removes “${confirm.row.title || confirm.row.id}” from the player lobby. Players will not see or launch it until you turn it on again.`
        : `Show “${confirm.row.title || confirm.row.id}” in the player lobby again (unless the integration lobby is off or this row is still marked hidden).`
      : confirm
        ? confirm.nextLobbyHidden
          ? `This hides every game from integration “${confirm.row.provider}” in the player lobby at once (${confirm.row.game_count} games). Individually hidden games stay hidden when the integration is on again.`
          : `Re-enable integration “${confirm.row.provider}” in the lobby. Games you hid individually will remain hidden.`
        : ''

  const confirmLabel =
    confirm?.kind === 'game'
      ? confirm.nextHidden
        ? 'Yes, turn off game'
        : 'Yes, turn on game'
      : confirm?.nextLobbyHidden
        ? 'Yes, turn off integration'
        : 'Yes, turn on integration'

  const confirmDanger =
    confirm?.kind === 'game' ? confirm?.nextHidden : confirm?.nextLobbyHidden

  return (
    <>
      <PageMeta title="Games · Admin" description="Catalog, visibility, and monitoring" />
      <PageBreadcrumb
        pageTitle="Games catalog"
        subtitle="Lobby visibility, studios & integrations, RTP stats, and player lobby links"
      />

      <div className="row row-cols-1 row-cols-sm-3 g-3 mb-3">
        <div className="col">
          <StatCard
            label="Total games"
            value={provLoading ? '—' : provErr ? '—' : formatCompact(catalogStats.totalGames)}
            iconClass="bi bi-controller"
            variant="primary"
          />
        </div>
        <div className="col">
          <StatCard
            label="Studios"
            value={provLoading ? '—' : provErr ? '—' : formatCompact(catalogStats.studioCount ?? 0)}
            iconClass="bi bi-building"
            variant="info"
          />
        </div>
        <div className="col">
          <StatCard
            label="Launches (24h)"
            value={launches24h != null ? formatCompact(launches24h) : '—'}
            iconClass="bi bi-play-btn"
            variant="success"
          />
        </div>
      </div>

      <ComponentCard
        title="Catalog integrations"
        desc="Integration rows (e.g. Blue Ocean). Turning one off hides its entire catalog from the lobby — this is not the same as individual game studios. Superadmin only."
      >
        {!canManageLobby ? (
          <div className="alert alert-secondary small py-2 mb-3" role="note">
            Lobby on/off requires <strong>superadmin</strong>. Your role:{' '}
            <span className="font-monospace">{role ?? 'unknown'}</span>.
          </div>
        ) : null}
        {provErr ? (
          <div className="alert alert-danger small d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span>{provErr}</span>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void loadProviders()}>
              Retry
            </button>
          </div>
        ) : null}
        {provLoading ? (
          <p className="text-secondary small mb-0">Loading integrations…</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col">Integration</th>
                  <th scope="col" className="text-end">
                    Games
                  </th>
                  <th scope="col" className="text-end">
                    Visible
                  </th>
                  <th scope="col" className="text-end">
                    In lobby
                  </th>
                  <th scope="col">Lobby</th>
                  {canManageLobby ? <th scope="col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.provider || '—'}>
                    <td className="font-monospace small">{p.provider || '—'}</td>
                    <td className="text-end small">{p.game_count}</td>
                    <td className="text-end small">{p.individually_visible_count}</td>
                    <td className="text-end small">{p.effective_lobby_visible_count}</td>
                    <td className="small">
                      {p.lobby_hidden ? (
                        <span className="badge text-bg-warning">Off</span>
                      ) : (
                        <span className="badge text-bg-success">On</span>
                      )}
                    </td>
                    {canManageLobby ? (
                      <td className="small">
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0"
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
        desc={`Loads up to ${FETCH_LIMIT} games for search and edits below — summary totals match the full catalog. Catalog sync updates Blue Ocean metadata into thumbnail_url; optional staff thumbnail URL overrides the lobby image for players. Superadmin only.`}
      >
        {err ? (
          <div className="alert alert-danger small d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span>{err}</span>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : null}

        {!provLoading && !provErr ? (
          <div className="row row-cols-2 row-cols-lg-5 g-2 mb-3">
            <div className="col">
              <div className="border rounded p-2 h-100 bg-body-tertiary">
                <div className="small text-secondary">In catalog</div>
                <div className="fs-5 fw-semibold">{formatCompact(catalogStats.totalGames)}</div>
              </div>
            </div>
            <div className="col">
              <div className="border rounded p-2 h-100 bg-body-tertiary">
                <div className="small text-secondary">In lobby</div>
                <div className="fs-5 fw-semibold text-success">{formatCompact(catalogStats.inLobby)}</div>
              </div>
            </div>
            <div className="col">
              <div className="border rounded p-2 h-100 bg-body-tertiary">
                <div className="small text-secondary">Hidden game</div>
                <div className="fs-5 fw-semibold text-warning">{formatCompact(catalogStats.hiddenGames)}</div>
              </div>
            </div>
            <div className="col">
              <div className="border rounded p-2 h-100 bg-body-tertiary">
                <div className="small text-secondary">Games under integration lobby off</div>
                <div className="fs-5 fw-semibold text-danger">{formatCompact(catalogStats.integrationLobbyOffGames)}</div>
              </div>
            </div>
            <div className="col">
              <div className="border rounded p-2 h-100 bg-body-tertiary">
                <div className="small text-secondary">Integrations</div>
                <div className="fs-5 fw-semibold">{formatCompact(catalogStats.integrationCount)}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="row g-2 align-items-end mb-3">
          <div className="col-lg-6">
            <label htmlFor="game-search" className="form-label small mb-1">
              Search
            </label>
            <input
              id="game-search"
              type="search"
              placeholder="Title, id, studio, integration, category, BOG id…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              className="form-control form-control-sm"
            />
          </div>
          <div className="col-lg-6">
            <span className="form-label small mb-1 d-block">Visibility</span>
            <div className="btn-group btn-group-sm" role="group" aria-label="Lobby visibility filter">
              {(['all', 'visible', 'hidden'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setVisibility(v)
                    setPage(1)
                  }}
                  className={`btn ${visibility === v ? 'btn-primary' : 'btn-outline-secondary'}`}
                >
                  {v === 'all' ? 'All' : v === 'visible' ? 'In lobby' : 'Not in lobby'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-secondary small">Loading…</p>
        ) : (
          <>
            <p className="mb-2 small text-secondary">
              Showing {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filtered.length)} of {filtered.length} matching in this table
              {!provLoading && !provErr && catalogStats.totalGames > rows.length
                ? ` · showing ${rows.length} of ${formatCompact(catalogStats.totalGames)} in table`
                : ''}
              {!provLoading && !provErr ? (
                <>
                  {' · '}
                  <span className="text-body-secondary">{formatCompact(catalogStats.totalGames)} games in catalog</span>
                </>
              ) : null}
            </p>
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0" style={{ minWidth: '1180px' }}>
                <thead className="table-light">
                  <tr>
                    <th className="px-3 py-2 font-medium">Thumb</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('title', 'Title')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('id', 'Game id')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('provider', 'Integration')}</th>
                    <th className="px-3 py-2 font-medium">{sortBtn('provider_system', 'Studio')}</th>
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
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <Thumbnail url={r.thumbnail_url} title={r.title} />
                          {r.thumbnail_url_override?.trim() ? (
                            <span className="text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
                              Custom
                            </span>
                          ) : null}
                        </div>
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
                      <td className="max-w-[8rem] truncate px-3 py-2 text-xs" title={r.provider_system}>
                        {r.provider_system?.trim() || '—'}
                      </td>
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
                            Integration off
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
                          <div className="flex flex-col gap-1">
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
                            <button
                              type="button"
                              className="text-start text-xs text-gray-600 underline dark:text-gray-400"
                              onClick={() => {
                                setThumbModal(r)
                                setThumbDraft(r.thumbnail_url_override?.trim() ?? '')
                              }}
                            >
                              Thumbnail…
                            </button>
                          </div>
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

            <div className="mt-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div className="d-flex align-items-center gap-2 small text-secondary">
                <label htmlFor="games-page-size" className="mb-0">
                  Rows per page
                </label>
                <select
                  id="games-page-size"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])
                    setPage(1)
                  }}
                  className="form-select form-select-sm w-auto"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="small text-secondary px-1">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  className="btn btn-outline-secondary btn-sm"
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

      {thumbModal ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="thumb-edit-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => setThumbModal(null)}
          />
          <div className="relative z-[1] w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 id="thumb-edit-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Lobby thumbnail
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {thumbModal.title || thumbModal.id}
            </p>
            {thumbModal.thumbnail_url_catalog?.trim() ? (
              <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-300">Catalog (sync):</span>{' '}
                {thumbModal.thumbnail_url_catalog}
              </p>
            ) : null}
            <label htmlFor="thumb-override-url" className="mt-4 block text-sm font-medium text-gray-800 dark:text-gray-200">
              Custom image URL (optional)
            </label>
            <textarea
              id="thumb-override-url"
              rows={3}
              value={thumbDraft}
              onChange={(e) => setThumbDraft(e.target.value)}
              placeholder="https://… Leave empty and save to use catalog image."
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-950 dark:text-white"
            />
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-gray-600"
                onClick={() => setThumbModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
                onClick={() => void runPatchThumbnail()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
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
