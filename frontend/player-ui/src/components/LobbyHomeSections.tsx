import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { PortraitGameThumb } from './PortraitGameThumb'
import { playerApiOriginConfigured, playerApiUrl } from '../lib/playerApiUrl'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { resolveProviderLogoCandidates } from '../lib/providerLogoUrl'
import { GameCardSkeleton } from './GameCardSkeleton'
import { IconBuilding2, IconChevronLeft, IconChevronRight } from './icons'
import { PulsingBrandTile } from './PulsingBrandTile'

type Game = {
  id: string
  title: string
  provider: string
  category: string
  thumbnail_url?: string
  thumb_rev?: number
  provider_system?: string
  live?: boolean
}

type ProviderAgg = { code: string; count: number }

/** Catalog uses plain fetch + `playerApiUrl` only — never Fingerprint or auth fingerprint payloads — so lobby tiles cannot break when security integrations change. */
async function fetchGames(query: string): Promise<Game[]> {
  const path = `/v1/games?${query}`
  const url = playerApiUrl(path)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      if (import.meta.env.DEV) {
        const hint = !playerApiOriginConfigured()
          ? ' Hint: set VITE_PLAYER_API_ORIGIN so /v1 hits the API, not the static host.'
          : ''
        console.warn(`[catalog] GET ${path} → ${res.status}${hint}`, url)
      }
      return []
    }
    const j = (await res.json()) as { games?: Game[] }
    return j.games ?? []
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[catalog] GET games failed (network)', url, e)
    }
    return []
  }
}

function aggregateProviders(games: Game[]): ProviderAgg[] {
  const m = new Map<string, number>()
  for (const g of games) {
    const studio = (g.provider_system ?? '').trim()
    const fallback = (g.provider ?? '').trim()
    const code =
      studio ||
      (fallback && fallback.toLowerCase() !== 'blueocean' ? fallback : '') ||
      'Other studios'
    m.set(code, (m.get(code) ?? 0) + 1)
  }
  return [...m.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)
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

/** Min interval between “tab visible” refetches (navigation refetches always run). */
const VISIBILITY_REFETCH_MS = 45_000

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
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Link to={viewAllTo} className={outlinedViewAllClass}>
        VIEW ALL
      </Link>
      <div
        className="flex min-h-9 overflow-hidden rounded-lg border border-white/[0.10] bg-casino-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-white/[0.14]"
        role="group"
        aria-label="Scroll games horizontally"
      >
        <button
          type="button"
          className="flex flex-1 min-w-[2.25rem] items-center justify-center px-2.5 py-2 text-white/82 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white active:bg-white/[0.12] focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-casino-primary/50 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Scroll left"
          onClick={onScrollLeft}
        >
          <IconChevronLeft size={16} aria-hidden />
        </button>
        <div className="w-px shrink-0 self-stretch bg-white/[0.10]" aria-hidden />
        <button
          type="button"
          className="flex flex-1 min-w-[2.25rem] items-center justify-center px-2.5 py-2 text-white/82 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white active:bg-white/[0.12] focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-casino-primary/50 disabled:pointer-events-none disabled:opacity-35"
          aria-label="Scroll right"
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
  viewAllTo,
  games,
  showSkeletons,
}: {
  title: string
  viewAllTo: string
  games: Game[]
  /** First fetch still in flight — pulsing tile placeholders (same footprint as real tiles). */
  showSkeletons?: boolean
}) {
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
          <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
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
          className="group/rowtitle flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-bold leading-tight tracking-tight text-white transition-colors duration-150 hover:text-white/95 sm:text-sm sm:font-extrabold"
        >
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
              VIEW ALL
            </Link>
          ) : (
            <>
              <Link
                to={viewAllTo}
                className={`${outlinedViewAllClass} shrink-0 min-[1280px]:hidden`}
              >
                VIEW ALL
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
        <p className="text-center text-xs text-casino-muted">No games in this row yet.</p>
      ) : null}
    </section>
  )
}

function ProviderLogoCard({ code, count }: { code: string; count: number }) {
  const candidates = useMemo(() => [...resolveProviderLogoCandidates(code)], [code])
  const [tryIndex, setTryIndex] = useState(0)

  useEffect(() => {
    setTryIndex(0)
  }, [code])

  const dead = candidates.length === 0 || tryIndex >= candidates.length
  const src = dead ? undefined : candidates[tryIndex]

  return (
    <Link
      to={`/casino/games?provider=${encodeURIComponent(code)}`}
      title={`${code} · ${count} games · filter by studio`}
      className="flex h-[52px] w-[148px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] border border-white/[0.09] bg-casino-surface px-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-casino-primary/40 sm:h-[58px] sm:w-[164px]"
    >
      {!dead && src ? (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className="max-h-[26px] w-auto max-w-[140px] object-contain brightness-0 invert opacity-[0.94] sm:max-h-[28px]"
          loading="lazy"
          onError={() => setTryIndex((i) => i + 1)}
        />
      ) : (
        <span className="max-w-full truncate text-[10px] font-extrabold uppercase tracking-[0.06em] text-white/72">
          {code}
        </span>
      )}
      <span className="sr-only">
        {count} games · filter catalog by this studio
      </span>
    </Link>
  )
}

function ProviderSection({ providers, showSkeletons }: { providers: ProviderAgg[]; showSkeletons?: boolean }) {
  const reduceMotion = usePrefersReducedMotion()
  const stripRef = useRef<HTMLDivElement>(null)

  const scrollStrip = useCallback((dir: -1 | 1) => {
    const el = stripRef.current
    if (!el) return
    const step = Math.max(el.clientWidth * 0.65, 220)
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }, [])

  return (
    <section className="mb-5" id="studios">
      <div className="mb-2 flex flex-nowrap items-center justify-between gap-2 sm:gap-2.5">
        <Link
          to="/casino/games#studios"
          className="group/prov flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-bold leading-tight tracking-tight text-white transition-colors duration-150 hover:text-white/95 sm:text-sm sm:font-extrabold"
        >
          <IconBuilding2 size={17} className="shrink-0 text-white/50 transition-colors group-hover/prov:text-casino-primary" aria-hidden />
          <span className="min-w-0">Studios</span>
          <IconChevronRight
            size={17}
            className="shrink-0 text-white/40 transition-colors group-hover/prov:text-casino-primary"
            aria-hidden
          />
        </Link>
        {providers.length > 0 && !showSkeletons && !reduceMotion ? (
          <ViewAllScrollCluster
            viewAllTo="/casino/games#studios"
            onScrollLeft={() => scrollStrip(-1)}
            onScrollRight={() => scrollStrip(1)}
          />
        ) : providers.length > 0 && !showSkeletons ? (
          <Link to="/casino/games#studios" className={outlinedViewAllClass}>
            VIEW ALL
          </Link>
        ) : null}
      </div>
      {showSkeletons ? (
        <div className="relative -mx-0.5" role="region" aria-label="Top studios">
          <div className="scrollbar-none flex gap-2 overflow-x-auto py-1 [-webkit-overflow-scrolling:touch]">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={`psk-${i}`}
                className="flex h-[52px] w-[148px] shrink-0 items-center justify-center rounded-[10px] border border-white/[0.09] bg-casino-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:h-[58px] sm:w-[164px]"
              >
                <PulsingBrandTile size="inline" />
              </div>
            ))}
          </div>
        </div>
      ) : providers.length === 0 ? (
        <p className="text-center text-xs text-casino-muted">No studio data yet.</p>
      ) : (
        <div className="relative -mx-0.5" role="region" aria-label="Top studios">
          <div
            ref={stripRef}
            className={
              reduceMotion
                ? 'scrollbar-none flex flex-wrap justify-center gap-2 py-0.5'
                : 'scrollbar-none flex gap-2 overflow-x-auto py-1 [-webkit-overflow-scrolling:touch]'
            }
          >
            {providers.map((p) => (
              <ProviderLogoCard key={p.code} code={p.code} count={p.count} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

type LobbyHomeSectionsProps = {
  /** When operational `/health/operational` reports a new catalog sync time, refetch tiles (new thumb_rev / URLs). */
  catalogSyncAt?: string | null
}

const LobbyHomeSections: FC<LobbyHomeSectionsProps> = ({ catalogSyncAt }) => {
  const location = useLocation()
  const lastVisFetchAt = useRef(0)

  const [featured, setFeatured] = useState<Game[]>([])
  /** Used when `/v1/games?featured=1` returns zero rows — must differ from alphabetical slots strip. */
  const [hotFallback, setHotFallback] = useState<Game[]>([])
  const [slots, setSlots] = useState<Game[]>([])
  const [newRel, setNewRel] = useState<Game[]>([])
  const [live, setLive] = useState<Game[]>([])
  const [bonus, setBonus] = useState<Game[]>([])
  const [providers, setProviders] = useState<ProviderAgg[]>([])
  const [visRefresh, setVisRefresh] = useState(0)
  const [homeRowsReady, setHomeRowsReady] = useState(false)
  /** Studio strip aggregates from a heavier `limit=200` fetch — tracked separately so game rows can resolve first. */
  const [providersReady, setProvidersReady] = useState(false)

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastVisFetchAt.current < VISIBILITY_REFETCH_MS) return
      lastVisFetchAt.current = now
      setVisRefresh((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    let cancel = false
    setHomeRowsReady(false)
    setProvidersReady(false)
    void (async () => {
      const lim = String(HOME_FETCH_LIMIT)
      const [f, s, n, l, b, hotBack] = await Promise.all([
        fetchGames(`integration=blueocean&featured=1&limit=${lim}`),
        fetchGames(`integration=blueocean&category=slots&limit=${lim}`),
        fetchGames(`integration=blueocean&category=new&limit=${lim}`),
        fetchGames(`integration=blueocean&category=live&limit=${lim}`),
        fetchGames(`integration=blueocean&category=bonus-buys&limit=${lim}`),
        fetchGames(`integration=blueocean&limit=${lim}&sort=new`),
      ])
      if (cancel) return
      setFeatured(dedupeGamesById(f))
      setHotFallback(dedupeGamesById(hotBack))
      setSlots(dedupeGamesById(s))
      setNewRel(dedupeGamesById(n))
      setLive(dedupeGamesById(l))
      setBonus(dedupeGamesById(b))
      setHomeRowsReady(true)

      const bulk = await fetchGames('integration=blueocean&limit=200&sort=provider')
      if (cancel) return
      setProviders(aggregateProviders(dedupeGamesById(bulk)))
      setProvidersReady(true)
    })()
    return () => {
      cancel = true
    }
  }, [location.pathname, location.key, visRefresh, catalogSyncAt])

  const logoRowGames = featured.length > 0 ? featured : hotFallback
  const showSkeletons = !homeRowsReady

  return (
    <div className="min-w-0">
      <GameSection
        title="Hot now"
        viewAllTo="/casino/challenges"
        games={logoRowGames}
        showSkeletons={showSkeletons}
      />
      <GameSection title="Slots" viewAllTo="/casino/slots" games={slots} showSkeletons={showSkeletons} />
      <ProviderSection providers={providers} showSkeletons={!providersReady} />
      <GameSection title="New releases" viewAllTo="/casino/new" games={newRel} showSkeletons={showSkeletons} />
      <GameSection title="Live casino" viewAllTo="/casino/live" games={live} showSkeletons={showSkeletons} />
      <GameSection title="Bonus buys" viewAllTo="/casino/bonus-buys" games={bonus} showSkeletons={showSkeletons} />
    </div>
  )
}

export default LobbyHomeSections
