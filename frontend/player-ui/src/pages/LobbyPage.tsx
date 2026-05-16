import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import { useSharedOperationalHealth } from '../context/OperationalHealthContext'
import type { OperationalHealth } from '../hooks/useOperationalHealth'
import CasinoCatalogSearchStrip from '../components/CasinoCatalogSearchStrip'
import { RequireAuthLink } from '../components/RequireAuthLink'
import { usePlayerAuth } from '../playerAuth'
import {
  clearCatalogReturn,
  getCatalogReturnForNavigation,
  LOBBY_CATALOG_SECTION_SET,
  persistCatalogReturnSnapshot,
  PLAYER_MAIN_SCROLL_ID,
  RESTORE_MAIN_SCROLL_STATE_KEY,
  saveCatalogReturnBeforeGameOpen,
  type RestoreScrollLocationState,
} from '../lib/catalogReturn'
import { messageGamesListUpstream, messageLobbyCatalogNetwork } from '../lib/playerNetworkCopy'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import {
  getFavouriteIds,
  getRecentIds,
  isFavourite,
  toggleFavouriteWithServerSync,
} from '../lib/gameStorage'
import LobbyHomeSections from '../components/LobbyHomeSections'
import { GameCardSkeleton } from '../components/GameCardSkeleton'
import PromoHero from '../components/PromoHero'
import RecentWinsMarquee from '../components/RecentWinsMarquee'
import { useCompleteInitialLoad } from '../context/InitialAppLoadContext'
import { useFavouritesRevision } from '../hooks/useFavouritesRevision'
import ChallengesPageContent from '../components/challenges/ChallengesPageContent'
import { GameThumbInteractiveShell } from '../components/GameThumbInteractiveShell'
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
  effective_rtp_pct?: number
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

const SECTION_SET = LOBBY_CATALOG_SECTION_SET

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
  t: TFunction,
): string {
  const noBlueOceanGames =
    op?.blueocean_configured === true &&
    typeof op?.blueocean_visible_games_count === 'number' &&
    op.blueocean_visible_games_count === 0
  const noGamesInDb =
    typeof op?.visible_games_count === 'number' && op.visible_games_count === 0
  const staff = t('catalog.empty.staffOpsHint')

  if (sec === 'featured' || sec === 'challenges') {
    return t('catalog.empty.featuredChallenges')
  }
  if (q.trim() || provider.trim() || pillActive('gameshows') || pillActive('blackjack')) {
    return t('catalog.empty.searchFilters')
  }
  if (sec === 'slots' || sec === 'live' || sec === 'new' || sec === 'bonus-buys') {
    return `${t('catalog.empty.category')} ${staff}`
  }
  if (noBlueOceanGames || (!op?.blueocean_configured && noGamesInDb)) {
    return `${t('catalog.empty.blueOceanNone')} ${staff}`
  }
  return t('catalog.empty.default')
}

function catalogSectionTitle(sec: Section, t: TFunction): string {
  const keys: Record<Section, string> = {
    games: 'catalog.section.games',
    featured: 'catalog.section.featured',
    challenges: 'catalog.section.challenges',
    slots: 'catalog.section.slots',
    live: 'catalog.section.live',
    new: 'catalog.section.new',
    favourites: 'catalog.section.favourites',
    recent: 'catalog.section.recent',
    'bonus-buys': 'catalog.section.bonusBuys',
  }
  return t(keys[sec])
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

const CATALOG_SKELETON_COUNT = 18

export default function LobbyPage() {
  const { data: operationalData } = useSharedOperationalHealth()
  const { t } = useTranslation()
  const location = useLocation()
  const { pathname } = location
  const { section = 'games' } = useParams<{ section: Section }>()
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const sort = searchParams.get('sort') ?? 'name'
  const provider = searchParams.get('provider') ?? ''

  const completeInitialLoad = useCompleteInitialLoad()

  const { isAuthenticated, refreshProfile, apiFetch } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const [games, setGames] = useState<Game[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const favRev = useFavouritesRevision()

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

  /** Full-screen first-load overlay: casino catalog routes other than dashboard home dismiss immediately. */
  useEffect(() => {
    if (!isDashboardHome) completeInitialLoad()
  }, [isDashboardHome, completeInitialLoad])

  /** Dashboard home: hide boot overlay as soon as shell lays out — rows keep skeletons until LobbyHomeSections fetch completes. */
  useLayoutEffect(() => {
    if (isDashboardHome) completeInitialLoad()
  }, [isDashboardHome, completeInitialLoad])

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
            setLoadErr(messageGamesListUpstream(res.status))
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
          setLoadErr(messageGamesListUpstream(res.status))
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
          toastPlayerNetworkError(messageLobbyCatalogNetwork(), 'GET /v1/games (lobby)')
          setLoadErr(messageLobbyCatalogNetwork())
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
    favRev,
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
        setLoadErr(messageGamesListUpstream(res.status))
        return
      }
      const j = (await res.json()) as { games: Game[] }
      const raw = j.games ?? []
      const batch = dedupeGamesById(raw)
      setGames((prev) => dedupeGamesById([...prev, ...batch]))
      setHasMore(raw.length === PAGE_SIZE)
    } catch {
      toastPlayerNetworkError(messageLobbyCatalogNetwork(), 'GET /v1/games (load more)')
      setLoadErr(messageLobbyCatalogNetwork())
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
      <div className="player-casino-max min-w-0 shrink-0 pb-12 pt-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:pt-4 sm:pl-[max(1.25rem,env(safe-area-inset-left,0px))] sm:pr-[max(1.25rem,env(safe-area-inset-right,0px))] md:pl-[max(1.5rem,env(safe-area-inset-left,0px))] md:pr-[max(1.5rem,env(safe-area-inset-right,0px))] lg:pl-[max(2rem,env(safe-area-inset-left,0px))] lg:pr-[max(2rem,env(safe-area-inset-right,0px))]">
        <PromoHero />
        <RecentWinsMarquee />
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
      {loadErr ? <p className="mb-3 text-sm text-red-400">{loadErr}</p> : null}

      <h1 className="mb-4 text-xl font-semibold tracking-tight text-casino-foreground md:text-2xl">
        {catalogSectionTitle(sec, t)}
      </h1>

      {games.length > 0 ? (
        <p className="mb-3 text-xs text-casino-muted">
          {t('catalog.shownCount', { count: games.length })}
          {showLoadMore ? ` · ${t('catalog.moreAvailable')}` : ''}
        </p>
      ) : null}

      <CasinoCatalogSearchStrip pathname={pathname} lobbyDashboardHome={false} />
      {sec === 'games' ? (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {[
            { id: 'gameshows', label: t('catalog.pillGameShows') },
            { id: 'blackjack', label: t('catalog.pillBlackjack') },
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

      <div className="casino-game-grid">
        {listLoading && games.length === 0
          ? Array.from({ length: CATALOG_SKELETON_COUNT }, (_, i) => (
              <div key={`sk-${i}`} className="group relative min-w-0">
                <div className="game-thumb-link pointer-events-none">
                  <GameCardSkeleton />
                </div>
              </div>
            ))
          : games.map((g) => {
              const lobbyTo = `/casino/game-lobby/${encodeURIComponent(g.id)}`
              return (
                <div key={g.id} className="group relative min-w-0">
                  <RequireAuthLink to={lobbyTo} className="group block game-thumb-link">
                    <div className="casino-game-tile-frame overflow-hidden rounded-casino-md bg-casino-elevated">
                      <GameThumbInteractiveShell effectiveRtpPct={g.effective_rtp_pct}>
                        <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
                      </GameThumbInteractiveShell>
                    </div>
                    <span className="sr-only">{g.title}</span>
                  </RequireAuthLink>
                  <button
                    type="button"
                    title={isFavourite(g.id) ? t('gameLobby.removeFavourite') : t('gameLobby.favourite')}
                    className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-casino-md border border-casino-border/80 bg-casino-bg/90 text-lg text-casino-primary shadow-sm backdrop-blur-sm hover:bg-casino-surface"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!isAuthenticated) {
                        saveCatalogReturnBeforeGameOpen()
                        openAuth('login', { navigateTo: lobbyTo })
                        return
                      }
                      toggleFavouriteWithServerSync(g.id, {
                        isAuthenticated,
                        apiFetch,
                        onSyncFailed: () =>
                          toastPlayerNetworkError(t('profile.networkErrorShort'), 'favourite sync'),
                      })
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
            {loadingMore ? t('catalog.loadingGames') : t('catalog.loadMore')}
          </button>
        </div>
      ) : null}
      {games.length === 0 && !loadErr && !listLoading ? (
        <p className="mt-6 text-center text-sm text-casino-muted">
          {emptySectionCopy(sec, q, provider, pillActive, operationalData, t)}
        </p>
      ) : null}
    </div>
  )
}
