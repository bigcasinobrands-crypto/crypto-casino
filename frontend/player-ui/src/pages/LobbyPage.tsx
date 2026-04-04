import { useCallback, useEffect, useMemo, useState, type FC } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import CatalogStatusLine from '../components/CatalogStatusLine'
import type { OperationalHealth } from '../hooks/useOperationalHealth'
import { usePlayerAuth } from '../playerAuth'
import {
  getFavouriteIds,
  getRecentIds,
  isFavourite,
  toggleFavourite,
} from '../lib/gameStorage'

type Game = {
  id: string
  title: string
  provider: string
  category: string
  thumbnail_url?: string
  provider_system?: string
  is_new?: boolean
  live?: boolean
}

type Section =
  | 'blueocean'
  | 'lobby'
  | 'featured'
  | 'slots'
  | 'live'
  | 'new'
  | 'favourites'
  | 'recent'

const SECTION_SET = new Set<string>([
  'blueocean',
  'lobby',
  'featured',
  'slots',
  'live',
  'new',
  'favourites',
  'recent',
])

const NETWORK_ERR =
  'Network error — is the API running on port 8080? From the repo root: npm run compose:up then npm run dev:api.'

function apiListErrorMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return 'Could not reach the API (bad gateway). Start Postgres (npm run compose:up) and the core API (npm run dev:api on port 8080).'
  }
  return 'Could not load games.'
}

function sortGamesByIdOrder(ids: string[], list: Game[]): Game[] {
  const order = new Map(ids.map((id, i) => [id, i]))
  return [...list].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
}

function emptySectionCopy(
  sec: Section,
  q: string,
  provider: string,
  pillActive: (pill: string) => boolean,
  op: OperationalHealth | null | undefined,
): string {
  const noVisible = typeof op?.visible_games_count === 'number' && op.visible_games_count === 0
  const staff = 'Run catalog sync from the staff console (Blue Ocean ops), or check that games are not hidden.'

  if (sec === 'featured') {
    return 'No featured games — set BLUEOCEAN_FEATURED_ID_HASHES on the API (comma-separated id_hash values), then sync the catalog.'
  }
  if (sec === 'blueocean') {
    if (q.trim() || provider.trim()) return 'No Blue Ocean games match your search or provider-system filter.'
    if (noVisible) return `No visible games yet. ${staff}`
    return `No Blue Ocean games match this view. ${staff}`
  }
  if (q.trim() || provider.trim() || pillActive('gameshows') || pillActive('blackjack')) {
    return 'No games match your search or filters. Try clearing filters or opening Lobby.'
  }
  if (sec === 'slots' || sec === 'live' || sec === 'new') {
    return 'No games in this category. Open Lobby for the full catalog, or run a catalog sync in the staff console if you expect titles here.'
  }
  if (noVisible) return `No visible games in the database yet. ${staff}`
  return 'No games in this view.'
}

const SECTION_TITLE: Record<Section, string> = {
  blueocean: 'Blue Ocean',
  lobby: 'Lobby',
  featured: 'Featured',
  slots: 'Slots',
  live: 'Live',
  new: 'New',
  favourites: 'Favourites',
  recent: 'Recent',
}

const GameThumb: FC<{ url?: string }> = ({ url }) => {
  const [bad, setBad] = useState(false)
  if (!url || bad) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-casino-muted">
        No image
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setBad(true)}
    />
  )
}

const CATALOG_PAGE_SIZE = 96

function usesCatalogPagination(section: Section): boolean {
  return (
    section === 'lobby' ||
    section === 'blueocean' ||
    section === 'slots' ||
    section === 'live' ||
    section === 'new'
  )
}

function buildListUrl(
  section: Section,
  q: string,
  sort: string,
  provider: string,
  pill: string,
  page?: { limit: number; offset: number },
): string {
  const p = new URLSearchParams()
  if (q.trim()) p.set('q', q.trim())
  if (sort) p.set('sort', sort)
  if (provider) p.set('provider', provider)
  if (pill.trim()) p.set('pill', pill.trim())
  if (page) {
    p.set('limit', String(page.limit))
    if (page.offset > 0) p.set('offset', String(page.offset))
  }
  switch (section) {
    case 'blueocean':
      p.set('integration', 'blueocean')
      break
    case 'featured':
      p.set('featured', '1')
      break
    case 'new':
      p.set('category', 'new')
      break
    case 'live':
      p.set('category', 'live')
      break
    case 'slots':
      p.set('category', 'slots')
      break
    default:
      break
  }
  const qs = p.toString()
  return qs ? `/v1/games?${qs}` : '/v1/games'
}

type LobbyPageProps = {
  operationalData?: OperationalHealth | null
}

export default function LobbyPage({ operationalData }: LobbyPageProps) {
  const { section = 'lobby' } = useParams<{ section: Section }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const sort = searchParams.get('sort') ?? 'name'
  const provider = searchParams.get('provider') ?? ''

  const { accessToken, me, balanceMinor, refreshProfile, logout } = usePlayerAuth()
  const [games, setGames] = useState<Game[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [, bump] = useState(0)
  const refreshFav = useCallback(() => bump((n) => n + 1), [])

  const secRaw = section ?? 'lobby'
  const sectionValid = SECTION_SET.has(secRaw)
  const sec = (sectionValid ? secRaw : 'lobby') as Section

  useEffect(() => {
    if (accessToken) void refreshProfile()
  }, [accessToken, refreshProfile])

  useEffect(() => {
    if (!sectionValid) return
    let cancelled = false
    void (async () => {
      setLoadErr(null)
      setLoadingMore(false)
      try {
        if (sec === 'favourites' || sec === 'recent') {
          setListLoading(true)
          const ids = sec === 'favourites' ? getFavouriteIds() : getRecentIds()
          if (ids.length === 0) {
            setGames([])
            setHasMore(false)
            setNextOffset(0)
            setListLoading(false)
            return
          }
          const res = await fetch(`/v1/games?ids=${encodeURIComponent(ids.join(','))}`)
          if (!res.ok) {
            setLoadErr(apiListErrorMessage(res.status))
            setListLoading(false)
            return
          }
          const j = (await res.json()) as { games: Game[] }
          const list = sortGamesByIdOrder(ids, j.games ?? [])
          if (!cancelled) {
            setGames(list)
            setHasMore(false)
            setNextOffset(0)
          }
          setListLoading(false)
          return
        }

        const pill = searchParams.get('pill') ?? ''

        if (usesCatalogPagination(sec)) {
          setListLoading(true)
          const res = await fetch(
            buildListUrl(sec, q, sort, provider, pill, { limit: CATALOG_PAGE_SIZE, offset: 0 }),
          )
          if (!res.ok) {
            setLoadErr(apiListErrorMessage(res.status))
            setListLoading(false)
            return
          }
          const j = (await res.json()) as { games: Game[] }
          const list = j.games ?? []
          if (!cancelled) {
            setGames(list)
            setNextOffset(list.length)
            setHasMore(list.length >= CATALOG_PAGE_SIZE)
          }
          setListLoading(false)
          return
        }

        setListLoading(true)
        const res = await fetch(buildListUrl(sec, q, sort, provider, pill))
        if (!res.ok) {
          setLoadErr(apiListErrorMessage(res.status))
          setListLoading(false)
          return
        }
        const j = (await res.json()) as { games: Game[] }
        if (!cancelled) {
          setGames(j.games ?? [])
          setHasMore(false)
          setNextOffset(0)
        }
        setListLoading(false)
      } catch {
        if (!cancelled) setLoadErr(NETWORK_ERR)
        setListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sectionValid, sec, q, sort, provider, searchParams])

  const loadMore = useCallback(async () => {
    if (!usesCatalogPagination(sec) || !hasMore || loadingMore || listLoading) return
    const pill = searchParams.get('pill') ?? ''
    setLoadingMore(true)
    setLoadErr(null)
    try {
      const res = await fetch(
        buildListUrl(sec, q, sort, provider, pill, { limit: CATALOG_PAGE_SIZE, offset: nextOffset }),
      )
      if (!res.ok) {
        setLoadErr(apiListErrorMessage(res.status))
        setLoadingMore(false)
        return
      }
      const j = (await res.json()) as { games: Game[] }
      const batch = j.games ?? []
      setGames((prev) => {
        const seen = new Set(prev.map((g) => g.id))
        const merged = [...prev]
        for (const g of batch) {
          if (!seen.has(g.id)) {
            seen.add(g.id)
            merged.push(g)
          }
        }
        return merged
      })
      setNextOffset((o) => o + batch.length)
      setHasMore(batch.length >= CATALOG_PAGE_SIZE)
    } catch {
      setLoadErr(NETWORK_ERR)
    } finally {
      setLoadingMore(false)
    }
  }, [sec, q, sort, provider, searchParams, hasMore, loadingMore, listLoading, nextOffset])

  if (!sectionValid) {
    return <Navigate to="/casino/blueocean" replace />
  }

  const pillHref = useMemo(
    () => (pill: string, active: boolean) => {
      const next = new URLSearchParams(searchParams)
      if (active) next.delete('pill')
      else next.set('pill', pill)
      const s = next.toString()
      return s ? `?${s}` : ''
    },
    [searchParams],
  )

  const pillActive = (pill: string) => searchParams.get('pill') === pill

  return (
    <div className="p-4">
      {accessToken ? (
        <p className="mb-4 text-sm text-casino-muted">
          Logged in as <span className="text-casino-foreground">{me?.email}</span> — balance minor
          units: <span className="text-casino-primary">{balanceMinor ?? '…'}</span>
          <button
            type="button"
            className="ml-4 text-xs text-casino-muted underline"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </p>
      ) : null}
      {loadErr ? <p className="mb-3 text-sm text-red-400">{loadErr}</p> : null}

      <h1 className="mb-2 text-xl font-semibold text-casino-foreground">{SECTION_TITLE[sec]}</h1>
      {operationalData ? <CatalogStatusLine data={operationalData} /> : null}
      {sec === 'blueocean' ? (
        <p className="mb-4 max-w-2xl text-sm text-casino-muted">
          Blue Ocean titles from the synced catalog (staff: Blue Ocean ops → Sync catalog). Lobby shows every visible
          game.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-xs text-casino-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              next.set('sort', e.target.value)
              setSearchParams(next, { replace: true })
            }}
            className="rounded-casino-md border border-casino-border bg-casino-bg px-2 py-2 text-sm text-casino-foreground"
          >
            <option value="name">Name</option>
            <option value="new">New first</option>
            <option value="provider">Provider</option>
          </select>
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-xs text-casino-muted">
          Provider system
          <input
            value={provider}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              const v = e.target.value.trim()
              if (v) next.set('provider', v)
              else next.delete('provider')
              setSearchParams(next, { replace: true })
            }}
            placeholder="e.g. pragmatic"
            className="rounded-casino-md border border-casino-border bg-casino-bg px-2 py-2 text-sm text-casino-foreground"
          />
        </label>
      </div>

      {usesCatalogPagination(sec) && games.length > 0 ? (
        <p className="mb-2 text-sm text-casino-muted">
          Showing {games.length} game{games.length === 1 ? '' : 's'}
          {hasMore ? ' — use Load more for the next page' : ''}
        </p>
      ) : null}
      {listLoading && games.length === 0 ? (
        <p className="mb-4 text-sm text-casino-muted">Loading games…</p>
      ) : null}

      {sec === 'lobby' ? (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {[
            { id: 'gameshows', label: 'Game shows' },
            { id: 'blackjack', label: 'Blackjack' },
          ].map(({ id, label }) => (
            <Link
              key={id}
              to={{ pathname: '/casino/lobby', search: pillHref(id, pillActive(id)) }}
              className={
                pillActive(id)
                  ? 'rounded-casino-sm bg-casino-primary px-3 py-1 font-medium text-casino-bg'
                  : 'rounded-casino-sm border border-casino-border px-3 py-1 text-casino-muted hover:border-casino-primary'
              }
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {games.map((g) => (
          <div
            key={g.id}
            className="group relative overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface text-sm transition hover:border-casino-primary"
          >
            <Link to={`/play/${encodeURIComponent(g.id)}`} className="block">
              <div className="aspect-video w-full overflow-hidden bg-casino-elevated">
                <GameThumb url={g.thumbnail_url} />
              </div>
              <div className="p-3">
                <div className="font-medium text-casino-foreground">{g.title}</div>
                <div className="text-casino-muted">
                  {g.category}
                  {g.provider_system ? ` · ${g.provider_system}` : ''}
                </div>
              </div>
            </Link>
            <button
              type="button"
              title={isFavourite(g.id) ? 'Remove favourite' : 'Add favourite'}
              className="absolute right-2 top-2 rounded-casino-sm bg-casino-bg/80 px-2 py-1 text-xs text-casino-primary backdrop-blur-sm"
              onClick={() => {
                toggleFavourite(g.id)
                refreshFav()
                if (sec === 'favourites') {
                  setGames((prev) => prev.filter((x) => x.id !== g.id))
                }
              }}
            >
              {isFavourite(g.id) ? '★' : '☆'}
            </button>
          </div>
        ))}
      </div>
      {usesCatalogPagination(sec) && hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loadingMore || listLoading}
            onClick={() => void loadMore()}
            className="rounded-casino-md border border-casino-border bg-casino-surface px-6 py-2 text-sm font-medium text-casino-foreground hover:border-casino-primary disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
      {games.length === 0 && !loadErr && !listLoading ? (
        <p className="mt-6 text-center text-sm text-casino-muted">
          {emptySectionCopy(sec, q, provider, pillActive, operationalData)}
        </p>
      ) : null}
    </div>
  )
}
