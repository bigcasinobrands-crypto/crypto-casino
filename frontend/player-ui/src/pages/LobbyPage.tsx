import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import type { OperationalHealth } from '../hooks/useOperationalHealth'
import CasinoCatalogSearchStrip from '../components/CasinoCatalogSearchStrip'
import { RequireAuthLink } from '../components/RequireAuthLink'
import { usePlayerAuth } from '../playerAuth'
import {
  clearCatalogReturn,
  getCatalogReturnForNavigation,
  persistCatalogReturnSnapshot,
  PLAYER_MAIN_SCROLL_ID,
  RESTORE_MAIN_SCROLL_STATE_KEY,
  saveCatalogReturnBeforeGameOpen,
  type RestoreScrollLocationState,
} from '../lib/catalogReturn'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import {
  getFavouriteIds,
  getRecentIds,
  isFavourite,
  toggleFavourite,
} from '../lib/gameStorage'
import LobbyHomeSections from '../components/LobbyHomeSections'
import PromoHero from '../components/PromoHero'
import ChallengesPageContent from '../components/challenges/ChallengesPageContent'
import { PortraitGameThumb } from '../components/PortraitGameThumb'

type Game = {
  id: string
  title: string
  provider: string
  category: string
  thumbnail_url?: string
  thumb_rev?: number
  provider_system?: string
  is_new?: boolean
  live?: boolean
}

/** Page size for API `limit` / `offset` (must match server max 2000). */
const PAGE_SIZE = 48

type Section =
  | 'games'
  | 'featured'
  | 'challenges'
  | 'slots'
  | 'live'
  | 'new'
  | 'favourites'
  | 'recent'
  | 'bonus-buys'

const SECTION_SET = new Set<string>([
  'games',
  'featured',
  'challenges',
  'slots',
  'live',
  'new',
  'favourites',
  'recent',
  'bonus-buys',
])

const NETWORK_ERR =
  'Network error — is the core API running? Set DEV_API_PROXY in frontend/player-ui/.env.development to match services/core PORT (e.g. http://127.0.0.1:9090), then restart Vite.'

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

/** API can echo duplicate id rows; keep first occurrence for stable grid keys. */
function dedupeGamesById<T extends { id: string }>(games: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const g of games) {
    const id = String(g.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(g)
  }
  return out
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

  if (sec === 'featured' || sec === 'challenges') {
    return 'No featured games — set BLUEOCEAN_FEATURED_ID_HASHES on the API (comma-separated id_hash values), then sync the catalog.'
  }
  if (q.trim() || provider.trim() || pillActive('gameshows') || pillActive('blackjack')) {
    return 'No games match your search or filters. Try clearing filters or browse all games.'
  }
  if (sec === 'slots' || sec === 'live' || sec === 'new' || sec === 'bonus-buys') {
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
  challenges: 'Challenges',
  slots: 'Slots',
  live: 'Live',
  new: 'New',
  favourites: 'Favourites',
  recent: 'Recent',
  'bonus-buys': 'Bonus buys',
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
    case 'challenges':
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
    case 'bonus-buys':
      p.set('category', 'bonus-buys')
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
  const location = useLocation()
  const { pathname } = location
  const { section = 'games' } = useParams<{ section: Section }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const sort = searchParams.get('sort') ?? 'name'
  const provider = searchParams.get('provider') ?? ''

  const { isAuthenticated, refreshProfile } = usePlayerAuth()
  const { openAuth } = useAuthModal()
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

  const isDashboardHome = useMemo(
    () =>
      sectionValid &&
      sec === 'games' &&
      !q.trim() &&
      !provider.trim() &&
      (searchParams.get('pill') ?? '') !== 'gameshows' &&
      (searchParams.get('pill') ?? '') !== 'blackjack' &&
      sort === 'name',
    [sectionValid, sec, q, provider, searchParams, sort],
  )

  /** Sidebar section / filters / home vs list — not `load more` (same key → scroll unchanged). */
  const catalogScrollResetKey = useMemo(() => {
    const pill = searchParams.get('pill') ?? ''
    return [sec, q, sort, provider, pill, isDashboardHome].join('\u0001')
  }, [sec, q, sort, provider, searchParams, isDashboardHome])

  useLayoutEffect(() => {
    const main = document.getElementById(PLAYER_MAIN_SCROLL_ID)
    if (!main) return
    const st = location.state as RestoreScrollLocationState | null
    let restoreY = st?.[RESTORE_MAIN_SCROLL_STATE_KEY]
    let consumedStorage = false
    if (typeof restoreY !== 'number' || !Number.isFinite(restoreY)) {
      const ret = getCatalogReturnForNavigation()
      const cur = `${location.pathname}${location.search}${location.hash}`
      if (ret && ret.path === cur) {
        restoreY = ret.scrollTop
        consumedStorage = true
      }
    }
    if (typeof restoreY === 'number' && Number.isFinite(restoreY)) {
      const prevBehavior = main.style.scrollBehavior
      main.style.scrollBehavior = 'auto'
      main.scrollTop = Math.max(0, restoreY)
      main.style.scrollBehavior = prevBehavior
      if (consumedStorage) {
        clearCatalogReturn()
      } else if (import.meta.env.PROD && typeof st?.[RESTORE_MAIN_SCROLL_STATE_KEY] === 'number') {
        clearCatalogReturn()
      }
      return
    }
    const prevBehavior = main.style.scrollBehavior
    main.style.scrollBehavior = 'auto'
    main.scrollTop = 0
    main.style.scrollBehavior = prevBehavior
    // Intentionally omit `location.state` from deps: when restoration clears, we must not re-run and jump to top.
  }, [catalogScrollResetKey])

  /** Sync session snapshot whenever section/filters/home-vs-list change so “Back to games” returns here, not an older section. */
  useEffect(() => {
    persistCatalogReturnSnapshot()
  }, [pathname, location.search, location.hash, catalogScrollResetKey])

  /** Keep scroll position in the snapshot while browsing (layout restore runs before effects, so scroll is current). */
  useEffect(() => {
    const main = document.getElementById(PLAYER_MAIN_SCROLL_ID)
    if (!main) return
    let debounce: number | undefined
    const onScroll = () => {
      if (debounce !== undefined) window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        persistCatalogReturnSnapshot()
        debounce = undefined
      }, 100)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(debounce)
      main.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) void refreshProfile()
  }, [isAuthenticated, refreshProfile])

  useEffect(() => {
    if (!sectionValid) return
    if (sec === 'challenges') {
      setGames([])
      setHasMore(false)
      setListLoading(false)
      setLoadErr(null)
      return
    }
    if (isDashboardHome) {
      setGames([])
      setHasMore(false)
      setListLoading(false)
      setLoadErr(null)
      return
    }
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
          const listPath = `/v1/games?integration=blueocean&ids=${encodeURIComponent(ids.join(','))}`
          const res = await playerFetch(listPath)
          if (!res.ok) {
            const parsed = await readApiError(res)
            const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
            toastPlayerApiError(parsed, res.status, `GET ${listPath}`, rid)
            setLoadErr(apiListErrorMessage(res.status))
            setListLoading(false)
            return
          }
          const j = (await res.json()) as { games: Game[] }
          const list = dedupeGamesById(sortGamesByIdOrder(ids, j.games ?? []))
          if (!cancelled) setGames(list)
          setListLoading(false)
          return
        }

        const pill = searchParams.get('pill') ?? ''
        const listUrl = buildListUrl(sec, q, sort, provider, pill, 0, PAGE_SIZE)
        const res = await playerFetch(listUrl)
        if (!res.ok) {
          const parsed = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          toastPlayerApiError(parsed, res.status, `GET ${listUrl}`, rid)
          setLoadErr(apiListErrorMessage(res.status))
          setListLoading(false)
          return
        }
        const j = (await res.json()) as { games: Game[] }
        const raw = j.games ?? []
        const batch = dedupeGamesById(raw)
        if (!cancelled) {
          setGames(batch)
          setHasMore(raw.length === PAGE_SIZE)
        }
        setListLoading(false)
      } catch {
        if (!cancelled) {
          toastPlayerNetworkError(NETWORK_ERR, 'GET /v1/games (lobby)')
          setLoadErr(NETWORK_ERR)
        }
        setListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Refetch when Blue Ocean catalog sync finishes (operational health exposes last_catalog_sync_at).
    // Without this, the lobby keeps stale games/thumbnails until the player navigates or hard-refreshes.
  }, [
    sectionValid,
    sec,
    q,
    sort,
    provider,
    searchParams,
    isDashboardHome,
    operationalData?.last_catalog_sync_at,
  ])

  const loadMore = useCallback(async () => {
    if (!sectionValid) return
    if (sec === 'favourites' || sec === 'recent') return
    if (listLoading || loadingMore || !hasMore) return
    setLoadingMore(true)
    setLoadErr(null)
    try {
      const pill = searchParams.get('pill') ?? ''
      const moreUrl = buildListUrl(sec, q, sort, provider, pill, games.length, PAGE_SIZE)
      const res = await playerFetch(moreUrl)
      if (!res.ok) {
        const parsed = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(parsed, res.status, `GET ${moreUrl}`, rid)
        setLoadErr(apiListErrorMessage(res.status))
        return
      }
      const j = (await res.json()) as { games: Game[] }
      const raw = j.games ?? []
      const batch = dedupeGamesById(raw)
      setGames((prev) => dedupeGamesById([...prev, ...batch]))
      setHasMore(raw.length === PAGE_SIZE)
    } catch {
      toastPlayerNetworkError(NETWORK_ERR, 'GET /v1/games (load more)')
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

  const showLoadMore =
    sectionValid &&
    sec !== 'favourites' &&
    sec !== 'recent' &&
    hasMore &&
    games.length > 0

  if (!sectionValid) {
    return <Navigate to="/casino/games" replace />
  }

  if (isDashboardHome) {
    return (
      <div className="player-casino-max min-w-0 shrink-0 px-4 pb-12 pt-4 sm:px-5 sm:pt-5 md:px-6 lg:px-8">
        <PromoHero />
        <CasinoCatalogSearchStrip pathname={pathname} lobbyDashboardHome={isDashboardHome} />
        <LobbyHomeSections catalogSyncAt={operationalData?.last_catalog_sync_at} />
      </div>
    )
  }

  if (sec === 'challenges') {
    return (
      <div className="player-casino-max min-w-0 shrink-0 px-4 pb-12 pt-8 sm:px-5 md:px-8 md:pt-10 lg:px-8">
        <ChallengesPageContent />
      </div>
    )
  }

  return (
    <div className="player-casino-max min-w-0 px-4 pb-12 pt-5 sm:px-5 md:px-6 lg:px-8">
      <CasinoCatalogSearchStrip pathname={pathname} lobbyDashboardHome={false} />
      {loadErr ? <p className="mb-3 text-sm text-red-400">{loadErr}</p> : null}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-casino-foreground md:text-2xl">
          {SECTION_TITLE[sec]}
        </h1>
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
              <option value="provider">Studio</option>
            </select>
          </label>
          <label className="flex min-w-[140px] flex-col gap-1 text-xs text-casino-muted">
            Studio
            <input
              value={provider}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams)
                const v = e.target.value.trim()
                if (v) next.set('provider', v)
                else next.delete('provider')
                setSearchParams(next, { replace: true })
              }}
              placeholder="e.g. Pragmatic"
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

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-2.5 md:grid-cols-4 md:gap-3 lg:grid-cols-6 lg:gap-3 xl:grid-cols-7 xl:gap-3 2xl:grid-cols-8 2xl:gap-2.5 min-[1700px]:grid-cols-9 min-[1920px]:grid-cols-10">
        {games.map((g) => {
          const lobbyTo = `/casino/game-lobby/${encodeURIComponent(g.id)}`
          return (
            <div key={g.id} className="group relative">
              <RequireAuthLink to={lobbyTo} className="group game-thumb-link">
                <div className="aspect-[3/4] w-full overflow-hidden rounded-casino-md bg-casino-elevated">
                  <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
                </div>
                <span className="sr-only">{g.title}</span>
              </RequireAuthLink>
              <button
                type="button"
                title={isFavourite(g.id) ? 'Remove favourite' : 'Favourite'}
                className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-casino-md border border-casino-border/80 bg-casino-bg/90 text-lg text-casino-primary shadow-sm backdrop-blur-sm hover:bg-casino-surface"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!isAuthenticated) {
                    saveCatalogReturnBeforeGameOpen()
                    openAuth('login', { navigateTo: lobbyTo })
                    return
                  }
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
