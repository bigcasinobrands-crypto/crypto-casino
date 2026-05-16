import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { GameThumbInteractiveShell } from './GameThumbInteractiveShell'
import { PortraitGameThumb } from './PortraitGameThumb'
import { parsePlayerApiErrorCodeFromBody, parsePlayerApiErrorCodeFromValue } from '../lib/playerApiErrorCode'
import { emitPlayerBarrierFromBody, emitPlayerBarrierIfKnown } from '../lib/playerBarrierSync'
import { playerApiOriginConfigured, playerApiUrl } from '../lib/playerApiUrl'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { GameCardSkeleton } from './GameCardSkeleton'
import { IconBanknote, IconChevronLeft, IconChevronRight, IconFlame, IconGem, IconRadio, IconSparkles } from './icons'
import RecentWinsMarquee from './RecentWinsMarquee'
import StudioMarqueeSection from './StudioMarqueeSection'

type Game = {
  id: string
  title: string
  provider: string
  category: string
  thumbnail_url?: string
  thumb_rev?: number
  provider_system?: string
  live?: boolean
  /** From API `effective_rtp_pct` when games.metadata includes it. */
  effective_rtp_pct?: number
}

type CatalogFault = 'relative' | 'http' | 'network' | 'bad_body'

function worseCatalogFault(a: CatalogFault | null, b: CatalogFault | null): CatalogFault | null {
  if (!b) return a
  if (!a) return b
  const rank: Record<CatalogFault, number> = { http: 1, bad_body: 2, network: 3, relative: 4 }
  return rank[b] > rank[a] ? b : a
}

/** Prefer showing the strongest site-access signal when parallel catalog requests disagree. */
function worseBarrierCode(a: string | null, b: string | null): string | null {
  if (!b) return a
  if (!a) return b
  const rank = (c: string) => {
    if (c === 'site_maintenance') return 30
    if (c === 'geo_blocked') return 20
    if (c === 'ip_blocked') return 10
    return 1
  }
  return rank(b) > rank(a) ? b : a
}

/** Catalog uses plain fetch + `playerApiUrl` only — never Fingerprint or auth fingerprint payloads — so lobby tiles cannot break when security integrations change. */
async function fetchGames(query: string): Promise<{
  games: Game[]
  fault?: CatalogFault
  status?: number
  barrierCode?: string
}> {
  const path = `/v1/games?${query}`
  const url = playerApiUrl(path)
  const isRelative = !(url.startsWith('https://') || url.startsWith('http://'))

  try {
    const res = await fetch(url)
    const text = await res.text()
    const barrierFromText = parsePlayerApiErrorCodeFromBody(text)
    if (!res.ok) emitPlayerBarrierFromBody(text)

    if (!res.ok) {
      if (import.meta.env.DEV) {
        const hint = !playerApiOriginConfigured()
          ? ' Hint: set VITE_PLAYER_API_ORIGIN so /v1 hits the API, not the static host.'
          : ''
        console.warn(`[catalog] GET ${path} → ${res.status}${hint}`, url)
      }
      return {
        games: [],
        fault: isRelative ? 'relative' : 'http',
        status: res.status,
        barrierCode: barrierFromText,
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      if (import.meta.env.DEV) {
        console.warn('[catalog] GET games returned non-JSON (often index.html when API origin is missing)', url)
      }
      return {
        games: [],
        fault: isRelative ? 'relative' : 'bad_body',
        status: res.status,
        barrierCode: barrierFromText,
      }
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { games?: unknown }).games)) {
      const bc = barrierFromText || parsePlayerApiErrorCodeFromValue(parsed)
      emitPlayerBarrierIfKnown(bc)
      return {
        games: [],
        fault: isRelative ? 'relative' : 'bad_body',
        status: res.status,
        barrierCode: bc,
      }
    }

    const rawGames = (parsed as { games: Game[] }).games ?? []
    return { games: rawGames }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[catalog] GET games failed (network)', url, e)
    }
    return { games: [], fault: 'network' }
  }
}

/** Drop duplicate IDs (keeps order; avoids doubled tiles if the API echoes rows). */
function dedupeGamesById(games: Game[]): Game[] {
  const seen = new Set<string>()
  const out: Game[] = []
  for (const g of games) {
    const id = String(g.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(g)
  }
  return out
}

/** Desktop horizontal row: max tiles fetched into each home section strip. */
const HOME_SECTION_PREVIEW_CAP = 24

/** API / slice caps — phone horizontal strip, tablet grid, desktop horizontal row up to 24 */
const HOME_FETCH_LIMIT = 24

/** Phone home sections: 3 columns × 2 rows per horizontal “page”, chunked in JS. */
const PHONE_HOME_CHUNK = 6

function chunkIntoSix<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += PHONE_HOME_CHUNK) {
    out.push(items.slice(i, i + PHONE_HOME_CHUNK))
  }
  return out
}

/** Matches `.casino-home-section-strip` tiers: horizontal scroll phone, grid tablet, row desktop. */
function homeSectionTileCapForWidth(width: number): number {
  /* Phone: same cap as fetch — tiles live in a horizontal strip; swipe right reveals more. */
  if (width < 768) return HOME_FETCH_LIMIT
  if (width < 1024) return 12
  if (width < 1280) return 14
  return HOME_SECTION_PREVIEW_CAP
}

function useHomeSectionTileCap(): number {
  const [cap, setCap] = useState<number>(() =>
    typeof window !== 'undefined' ? homeSectionTileCapForWidth(window.innerWidth) : HOME_SECTION_PREVIEW_CAP,
  )

  useEffect(() => {
    const onResize = () => setCap(homeSectionTileCapForWidth(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return cap
}

function usePhoneHomeStrip(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const fn = () => setNarrow(mq.matches)
    fn()
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  return narrow
}

const outlinedViewAllClass =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-white/[0.10] bg-casino-surface px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/92 no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-white/[0.18] hover:bg-casino-chip-hover hover:text-white active:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50'

/** Pigmo-style: bordered “VIEW ALL” + twin chevron control (scroll strip horizontally). */
function ViewAllScrollCluster({
  viewAllTo,
  onScrollLeft,
  onScrollRight,
}: {
  viewAllTo: string
  onScrollLeft: () => void
  onScrollRight: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Link to={viewAllTo} className={outlinedViewAllClass}>
        {t('lobby.viewAll')}
      </Link>
      <div
        className="flex min-h-9 overflow-hidden rounded-lg border border-white/[0.10] bg-casino-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-white/[0.14]"
        role="group"
        aria-label={t('lobby.scrollGamesHorizontal')}
      >
        <button
          type="button"
          className="flex flex-1 min-w-[2.25rem] items-center justify-center px-2.5 py-2 text-white/82 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white active:bg-white/[0.12] focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-casino-primary/50 disabled:pointer-events-none disabled:opacity-35"
          aria-label={t('lobby.scrollLeft')}
          onClick={onScrollLeft}
        >
          <IconChevronLeft size={16} aria-hidden />
        </button>
        <div className="w-px shrink-0 self-stretch bg-white/[0.10]" aria-hidden />
        <button
          type="button"
          className="flex flex-1 min-w-[2.25rem] items-center justify-center px-2.5 py-2 text-white/82 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white active:bg-white/[0.12] focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-casino-primary/50 disabled:pointer-events-none disabled:opacity-35"
          aria-label={t('lobby.scrollRight')}
          onClick={onScrollRight}
        >
          <IconChevronRight size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}

function GameSection({
  title,
  icon,
  viewAllTo,
  games,
  showSkeletons,
}: {
  title: string
  /** Optional leading icon (matches casino nav / category semantics). */
  icon?: ReactNode
  viewAllTo: string
  games: Game[]
  /** Section-specific: hide skeleton as soon as this row’s catalog slice resolves (not gated on slower rows). */
  showSkeletons?: boolean
}) {
  const { t } = useTranslation()
  const reduceMotion = usePrefersReducedMotion()
  const stripRef = useRef<HTMLDivElement>(null)
  const tileCap = useHomeSectionTileCap()
  const isPhoneStrip = usePhoneHomeStrip()

  const previewGames = useMemo(
    () => dedupeGamesById(games.slice(0, tileCap)),
    [games, tileCap],
  )

  const phoneChunks = useMemo(
    () => (isPhoneStrip ? chunkIntoSix(previewGames) : null),
    [isPhoneStrip, previewGames],
  )

  const skeletonTileCount = Math.min(tileCap, 12)

  const scrollStrip = useCallback(
    (dir: -1 | 1) => {
      const el = stripRef.current
      if (!el) return
      let step = Math.max(el.clientWidth * 0.65, 240)
      if (isPhoneStrip) {
        /* One chunk = one full strip viewport width (3×2 page). */
        step = el.clientWidth
      }
      el.scrollBy({ left: dir * step, behavior: reduceMotion ? 'auto' : 'smooth' })
    },
    [isPhoneStrip, reduceMotion],
  )

  const tileLink = (g: Game) => (
    <div key={g.id} className="min-w-0" role="listitem">
      <RequireAuthLink
        to={`/casino/game-lobby/${encodeURIComponent(g.id)}`}
        className="group game-thumb-link block"
      >
        <div className="casino-game-tile-frame relative rounded-casino-md bg-casino-elevated ring-1 ring-white/[0.06]">
          <GameThumbInteractiveShell effectiveRtpPct={g.effective_rtp_pct}>
            <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
          </GameThumbInteractiveShell>
        </div>
        <span className="sr-only">{g.title}</span>
      </RequireAuthLink>
    </div>
  )

  return (
    <section className="mb-5 md:mb-6 min-[1280px]:mb-8">
      <div className="mb-2 flex flex-nowrap items-center justify-between gap-2 sm:mb-2.5 sm:gap-2.5 min-[1280px]:mb-3">
        <Link
          to={viewAllTo}
          className="group/rowtitle flex min-w-0 flex-1 items-center gap-2 text-[15px] font-bold leading-tight tracking-tight text-white transition-colors duration-150 hover:text-white/95 sm:text-sm sm:font-extrabold"
        >
          {icon ? (
            <span className="shrink-0 text-casino-primary [&>svg]:block" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span className="min-w-0">{title}</span>
          <IconChevronRight
            size={17}
            className="shrink-0 text-white/40 transition-colors duration-150 group-hover/rowtitle:text-casino-primary"
            aria-hidden
          />
        </Link>
        {games.length > 0 && !showSkeletons ? (
          reduceMotion ? (
            <Link to={viewAllTo} className={`${outlinedViewAllClass} shrink-0`}>
              {t('lobby.viewAll')}
            </Link>
          ) : (
            <>
              <Link
                to={viewAllTo}
                className={`${outlinedViewAllClass} shrink-0 min-[1280px]:hidden`}
              >
                {t('lobby.viewAll')}
              </Link>
              <div className="hidden min-[1280px]:block">
                <ViewAllScrollCluster
                  viewAllTo={viewAllTo}
                  onScrollLeft={() => scrollStrip(-1)}
                  onScrollRight={() => scrollStrip(1)}
                />
              </div>
            </>
          )
        ) : null}
      </div>

      <div className="relative min-w-0 w-full max-w-full">
        <div
          ref={stripRef}
          className={`casino-home-section-strip${isPhoneStrip ? ' casino-home-section-strip--phone' : ''}`}
          role="list"
        >
          {showSkeletons ? (
            isPhoneStrip ? (
              Array.from({ length: Math.ceil(skeletonTileCount / PHONE_HOME_CHUNK) }, (_, ci) => (
                <div
                  key={`sk-${title}-c-${ci}`}
                  className="casino-home-section-phone-chunk"
                  role="presentation"
                >
                  {Array.from({ length: Math.min(PHONE_HOME_CHUNK, skeletonTileCount - ci * PHONE_HOME_CHUNK) }, (_, i) => (
                    <div key={`sk-${title}-${ci}-${i}`} className="min-w-0" role="listitem">
                      <div className="game-thumb-link pointer-events-none block">
                        <GameCardSkeleton />
                      </div>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              Array.from({ length: skeletonTileCount }, (_, i) => (
                <div key={`sk-${title}-${i}`} className="min-w-0" role="listitem">
                  <div className="game-thumb-link pointer-events-none block">
                    <GameCardSkeleton />
                  </div>
                </div>
              ))
            )
          ) : isPhoneStrip && phoneChunks ? (
            phoneChunks.map((chunk, ci) => (
              <div key={`${title}-chunk-${ci}`} className="casino-home-section-phone-chunk" role="presentation">
                {chunk.map((g) => tileLink(g))}
              </div>
            ))
          ) : (
            previewGames.map((g) => tileLink(g))
          )}
        </div>
      </div>
      {!showSkeletons && games.length === 0 ? (
        <p className="text-center text-xs text-casino-muted">{t('lobby.noGamesInRow')}</p>
      ) : null}
    </section>
  )
}

type LobbyHomeSectionsProps = {
  /** Reserved for future soft refresh; home rows only refetch on route change to avoid skeleton/thumb flicker. */
  catalogSyncAt?: string | null
}

const LobbyHomeSections: FC<LobbyHomeSectionsProps> = ({ catalogSyncAt: _catalogSyncAt }) => {
  void _catalogSyncAt
  const { t } = useTranslation()
  const location = useLocation()
  /** Reset skeleton flags only when route identity changes — not on visibility/catalog soft refetch. */
  const prevRouteKeyRef = useRef<string | null>(null)
  /** Invalidates in-flight fetches when the route effect re-runs (strict mode / overlap). */
  const fetchGeneration = useRef(0)

  const [featured, setFeatured] = useState<Game[]>([])
  /** Used when `/v1/games?featured=1` returns zero rows — must differ from alphabetical slots strip. */
  const [hotFallback, setHotFallback] = useState<Game[]>([])
  const [featuredLoaded, setFeaturedLoaded] = useState(false)
  const [hotFallbackLoaded, setHotFallbackLoaded] = useState(false)

  const [slots, setSlots] = useState<Game[]>([])
  const [slotsLoaded, setSlotsLoaded] = useState(false)
  const [newRel, setNewRel] = useState<Game[]>([])
  const [newLoaded, setNewLoaded] = useState(false)
  const [live, setLive] = useState<Game[]>([])
  const [liveLoaded, setLiveLoaded] = useState(false)
  const [bonus, setBonus] = useState<Game[]>([])
  const [bonusLoaded, setBonusLoaded] = useState(false)
  const [catalogFault, setCatalogFault] = useState<CatalogFault | null>(null)
  const [catalogBarrierCode, setCatalogBarrierCode] = useState<string | null>(null)
  const routeKey = `${location.pathname}\u0000${location.key}`

  /** Only `routeKey` — periodic catalog sync / visibility must not clear rows or cancel requests (causes skeleton + thumb flash). */
  useEffect(() => {
    const gen = ++fetchGeneration.current
    const lim = String(HOME_FETCH_LIMIT)
    const routeChanged = prevRouteKeyRef.current !== routeKey
    if (routeChanged) {
      prevRouteKeyRef.current = routeKey
      setFeatured([])
      setHotFallback([])
      setSlots([])
      setNewRel([])
      setLive([])
      setBonus([])
      setFeaturedLoaded(false)
      setHotFallbackLoaded(false)
      setSlotsLoaded(false)
      setNewLoaded(false)
      setLiveLoaded(false)
      setBonusLoaded(false)
      setCatalogFault(null)
      setCatalogBarrierCode(null)
    }

    const apply = (
      result: Awaited<ReturnType<typeof fetchGames>>,
      setList: (g: Game[]) => void,
      setDone: (v: boolean) => void,
    ) => {
      if (gen !== fetchGeneration.current) return
      setCatalogFault((prev) => worseCatalogFault(prev, result.fault ?? null))
      setCatalogBarrierCode((prev) => worseBarrierCode(prev, result.barrierCode ?? null))
      setList(dedupeGamesById(result.games))
      setDone(true)
    }

    void fetchGames(`integration=blueocean&featured=1&limit=${lim}`).then((f) => apply(f, setFeatured, setFeaturedLoaded))
    void fetchGames(`integration=blueocean&limit=${lim}&sort=new`).then((h) => apply(h, setHotFallback, setHotFallbackLoaded))
    void fetchGames(`integration=blueocean&category=slots&limit=${lim}`).then((s) => apply(s, setSlots, setSlotsLoaded))
    void fetchGames(`integration=blueocean&category=new&limit=${lim}`).then((n) => apply(n, setNewRel, setNewLoaded))
    void fetchGames(`integration=blueocean&category=live&limit=${lim}`).then((l) => apply(l, setLive, setLiveLoaded))
    void fetchGames(`integration=blueocean&category=bonus-buys&limit=${lim}`).then((b) => apply(b, setBonus, setBonusLoaded))
  }, [routeKey])

  const logoRowGames = featured.length > 0 ? featured : hotFallback
  /** Hot row: wait for featured unless empty — then wait for fallback sorted-by-new list. */
  const hotRowReady =
    featuredLoaded && (featured.length > 0 || hotFallbackLoaded)

  const allCatalogLoaded =
    hotRowReady && slotsLoaded && newLoaded && liveLoaded && bonusLoaded
  const allRowsEmpty =
    featured.length === 0 &&
    hotFallback.length === 0 &&
    slots.length === 0 &&
    newRel.length === 0 &&
    live.length === 0 &&
    bonus.length === 0

  const catalogFaultMessage = useMemo(() => {
    if (!import.meta.env.PROD || !allCatalogLoaded || !allRowsEmpty) return null
    if (catalogBarrierCode === 'site_maintenance') return t('gameLobby.error.maintenance')
    if (catalogBarrierCode === 'geo_blocked') return t('gameLobby.error.geo_blocked')
    if (catalogBarrierCode === 'ip_blocked') return t('gameLobby.error.ip_blocked')
    if (!catalogFault) return null
    if (!playerApiOriginConfigured() || catalogFault === 'relative') {
      return t('lobby.catalogFaultOrigin')
    }
    if (catalogFault === 'network') {
      return t('lobby.catalogFaultCors')
    }
    return t('lobby.catalogFaultApi')
  }, [allCatalogLoaded, allRowsEmpty, catalogBarrierCode, catalogFault, t])

  return (
    <div className="min-w-0">
      {catalogFaultMessage ? (
        <div
          className="mb-4 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2.5 text-center text-[11px] font-semibold leading-snug text-red-100/95"
          role="alert"
        >
          {catalogFaultMessage}
        </div>
      ) : null}
      <GameSection
        icon={<IconFlame size={18} />}
        title={t('nav.casino.hot_now')}
        viewAllTo="/casino/challenges"
        games={logoRowGames}
        showSkeletons={!hotRowReady}
      />
      <RecentWinsMarquee />
      <GameSection
        icon={<IconGem size={18} />}
        title={t('nav.casino.slots')}
        viewAllTo="/casino/slots"
        games={slots}
        showSkeletons={!slotsLoaded}
      />
      <StudioMarqueeSection />
      <GameSection
        icon={<IconSparkles size={18} />}
        title={t('nav.casino.new_releases')}
        viewAllTo="/casino/new"
        games={newRel}
        showSkeletons={!newLoaded}
      />
      <GameSection
        icon={<IconRadio size={18} />}
        title={t('lobby.sectionLiveCasino')}
        viewAllTo="/casino/live"
        games={live}
        showSkeletons={!liveLoaded}
      />
      <GameSection
        icon={<IconBanknote size={18} />}
        title={t('nav.casino.bonus_buys')}
        viewAllTo="/casino/bonus-buys"
        games={bonus}
        showSkeletons={!bonusLoaded}
      />
    </div>
  )
}

export default LobbyHomeSections
