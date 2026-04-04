import { useCallback, useEffect, useMemo, useState, type FC } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import type { OperationalHealth } from '../hooks/useOperationalHealth'
import { usePlayerAuth } from '../playerAuth'
import { playerApiUrl } from '../lib/playerApiUrl'
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

/** Page size for API `limit` / `offset` (must match server max 2000). */
const PAGE_SIZE = 48

type Section = 'games' | 'featured' | 'slots' | 'live' | 'new' | 'favourites' | 'recent'

const SECTION_SET = new Set<string>(['games', 'featured', 'slots', 'live', 'new', 'favourites', 'recent'])

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
  const noBlueOceanGames =
    op?.blueocean_configured === true &&
    typeof op?.blueocean_visible_games_count === 'number' &&
    op.blueocean_visible_games_count === 0
  const noGamesInDb =
    typeof op?.visible_games_count === 'number' && op.visible_games_count === 0
  const staff = 'Run catalog sync from the staff console (Blue Ocean ops), or check that games are not hidden.'

  if (sec === 'featured') {
    return 'No featured games — set BLUEOCEAN_FEATURED_ID_HASHES on the API (comma-separated id_hash values), then sync the catalog.'
  }
  if (q.trim() || provider.trim() || pillActive('gameshows') || pillActive('blackjack')) {
    return 'No games match your search or filters. Try clearing filters or browse all games.'
  }
  if (sec === 'slots' || sec === 'live' || sec === 'new') {
    return `No games in this category. Open Games for the full catalog, or run a catalog sync in the staff console if you expect titles here. ${staff}`
  }
  if (noBlueOceanGames || (!op?.blueocean_configured && noGamesInDb)) {
    return `No games from the Blue Ocean catalog are visible yet. ${staff}`
  }
  return 'No games in this view.'
}

const SECTION_TITLE: Record<Section, string> = {
  games: 'Games',
  featured: 'Featured',
  slots: 'Slots',
  live: 'Live',
  new: 'New',
  favourites: 'Favourites',
  recent: 'Recent',
}

const PortraitThumb: FC<{ url?: string; title: string }> = ({ url, title }) => {
  const [bad, setBad] = useState(false)
  if (!url || bad) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-casino-elevated px-2 text-center text-xs text-casino-muted">
        {title}
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="h-full w-full object-cover object-center"
      loading="lazy"
      onError={() => setBad(true)}
    />
  )
}

function buildListUrl(
  section: Section,
  q: string,
  sort: string,
  provider: string,
  pill: string,
  offset: number,
  limit: number,
): string {
  const p = new URLSearchParams()
  // Casino catalog is the Blue Ocean API catalog (synced into our database).
  p.set('integration', 'blueocean')
  p.set('limit', String(limit))
  p.set('offset', String(offset))
  if (q.trim()) p.set('q', q.trim())
  if (sort) p.set('sort', sort)
  if (provider) p.set('provider', provider)
  if (pill.trim()) p.set('pill', pill.trim())
  switch (section) {
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
  return `/v1/games?${qs}`
}

type LobbyPageProps = {
  operationalData?: OperationalHealth | null
}

export default function LobbyPage({ operationalData }: LobbyPageProps) {
  const { section = 'games' } = useParams<{ section: Section }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const sort = searchParams.get('sort') ?? 'name'
  const provider = searchParams.get('provider') ?? ''

  const { accessToken, refreshProfile } = usePlayerAuth()
  const [games, setGames] = useState<Game[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [, bump] = useState(0)
  const refreshFav = useCallback(() => bump((n) => n + 1), [])

  const secRaw = section ?? 'games'
  const sectionValid = SECTION_SET.has(secRaw)
  const sec = (sectionValid ? secRaw : 'games') as Section

  useEffect(() => {
    if (accessToken) void refreshProfile()
  }, [accessToken, refreshProfile])

  useEffect(() => {
    if (!sectionValid) return
    let cancelled = false
    void (async () => {
      setLoadErr(null)
      setListLoading(true)
      try {
        if (sec === 'favourites' || sec === 'recent') {
          const ids = sec === 'favourites' ? getFavouriteIds() : getRecentIds()
          if (ids.length === 0) {
            if (!cancelled) {
              setGames([])
            }
            setListLoading(false)
            return
          }
          const res = await fetch(
            playerApiUrl(
              `/v1/games?integration=blueocean&ids=${encodeURIComponent(ids.join(','))}`,
            ),
          )
          if (!res.ok) {
            setLoadErr(apiListErrorMessage(res.status))
            setListLoading(false)
            return
          }
          const j = (await res.json()) as { games: Game[] }
          const list = sortGamesByIdOrder(ids, j.games ?? [])
          if (!cancelled) setGames(list)
          setListLoading(false)
          return
        }

        const pill = searchParams.get('pill') ?? ''
        const res = await fetch(
          playerApiUrl(buildListUrl(sec, q, sort, provider, pill, 0, PAGE_SIZE)),
        )
        if (!res.ok) {
          setLoadErr(apiListErrorMessage(res.status))
          setListLoading(false)
          return
        }
        const j = (await res.json()) as { games: Game[] }
        const batch = j.games ?? []
        if (!cancelled) {
          setGames(batch)
          setHasMore(batch.length === PAGE_SIZE)
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
    if (!sectionValid) return
    if (sec === 'favourites' || sec === 'recent') return
    if (listLoading || loadingMore || !hasMore) return
    setLoadingMore(true)
    setLoadErr(null)
    try {
      const pill = searchParams.get('pill') ?? ''
      const res = await fetch(
        playerApiUrl(buildListUrl(sec, q, sort, provider, pill, games.length, PAGE_SIZE)),
      )
      if (!res.ok) {
        setLoadErr(apiListErrorMessage(res.status))
        return
      }
      const j = (await res.json()) as { games: Game[] }
      const batch = j.games ?? []
      setGames((prev) => [...prev, ...batch])
      setHasMore(batch.length === PAGE_SIZE)
    } catch {
      setLoadErr(NETWORK_ERR)
    } finally {
      setLoadingMore(false)
    }
  }, [
    sectionValid,
    sec,
    q,
    sort,
    provider,
    searchParams,
    games.length,
    hasMore,
    listLoading,
    loadingMore,
  ])

  const showLoadMore =
    sectionValid &&
    sec !== 'favourites' &&
    sec !== 'recent' &&
    hasMore &&
    games.length > 0

  if (!sectionValid) {
    return <Navigate to="/casino/games" replace />
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
      {loadErr ? <p className="mb-3 text-sm text-red-400">{loadErr}</p> : null}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-casino-foreground">{SECTION_TITLE[sec]}</h1>
        <div className="flex min-w-0 flex-1 flex-wrap gap-3 sm:justify-end">
          <label className="flex min-w-[120px] flex-col gap-1 text-xs text-casino-muted">
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
          <label className="flex min-w-[140px] flex-col gap-1 text-xs text-casino-muted">
            Provider
            <input
              value={provider}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams)
                const v = e.target.value.trim()
                if (v) next.set('provider', v)
                else next.delete('provider')
                setSearchParams(next, { replace: true })
              }}
              placeholder="e.g. ez"
              className="rounded-casino-md border border-casino-border bg-casino-bg px-2 py-2 text-sm text-casino-foreground"
            />
          </label>
        </div>
      </div>

      {games.length > 0 ? (
        <p className="mb-3 text-xs text-casino-muted">
          {games.length.toLocaleString()} shown
          {showLoadMore ? ' · more available' : ''}
        </p>
      ) : null}
      {listLoading && games.length === 0 ? (
        <p className="mb-4 text-sm text-casino-muted">Loading games…</p>
      ) : null}

      {sec === 'games' ? (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {[
            { id: 'gameshows', label: 'Game shows' },
            { id: 'blackjack', label: 'Blackjack' },
          ].map(({ id, label }) => (
            <Link
              key={id}
              to={{ pathname: '/casino/games', search: pillHref(id, pillActive(id)) }}
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {games.map((g) => {
          const lobbyTo = `/casino/game-lobby/${encodeURIComponent(g.id)}`
          return (
            <div key={g.id} className="group relative">
              <Link
                to={lobbyTo}
                className="block overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-sm ring-casino-primary/0 transition hover:border-casino-primary hover:ring-2 hover:ring-casino-primary/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary"
              >
                <div className="aspect-[3/4] w-full overflow-hidden bg-casino-elevated">
                  <PortraitThumb url={g.thumbnail_url} title={g.title} />
                </div>
                <span className="sr-only">{g.title}</span>
              </Link>
              <button
                type="button"
                title={isFavourite(g.id) ? 'Remove favourite' : 'Favourite'}
                className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-casino-md border border-casino-border/80 bg-casino-bg/90 text-lg text-casino-primary shadow-sm backdrop-blur-sm hover:bg-casino-surface"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
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
          )
        })}
      </div>
      {showLoadMore ? (
        <div className="mt-8 flex justify-center pb-8">
          <button
            type="button"
            disabled={loadingMore || listLoading}
            onClick={() => void loadMore()}
            className="rounded-casino-md border border-casino-border bg-casino-surface px-6 py-3 text-sm font-medium text-casino-foreground hover:border-casino-primary disabled:cursor-not-allowed disabled:opacity-50"
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
