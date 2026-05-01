import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { PortraitGameThumb } from './PortraitGameThumb'
import { playerApiUrl } from '../lib/playerApiUrl'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { resolveProviderLogoCandidates } from '../lib/providerLogoUrl'
import { IconBuilding2, IconChevronLeft, IconChevronRight } from './icons'

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

async function fetchGames(query: string): Promise<Game[]> {
  try {
    const res = await fetch(playerApiUrl(`/v1/games?${query}`))
    if (!res.ok) return []
    const j = (await res.json()) as { games?: Game[] }
    return j.games ?? []
  } catch {
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
        View all
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
}: {
  title: string
  viewAllTo: string
  games: Game[]
}) {
  const stripRef = useRef<HTMLDivElement>(null)

  const scrollStrip = useCallback((dir: -1 | 1) => {
    const el = stripRef.current
    if (!el) return
    const step = Math.max(el.clientWidth * 0.75, 280)
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }, [])

  return (
    <section className="mb-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link
          to={viewAllTo}
          className="group/rowtitle flex min-w-0 flex-1 items-center gap-2 text-sm font-extrabold tracking-tight text-white transition-colors duration-150 hover:text-white/95"
        >
          {title}
          <IconChevronRight
            size={18}
            className="shrink-0 text-white/45 transition-colors duration-150 group-hover/rowtitle:text-casino-primary"
            aria-hidden
          />
        </Link>
        {games.length > 0 ? (
          <ViewAllScrollCluster
            viewAllTo={viewAllTo}
            onScrollLeft={() => scrollStrip(-1)}
            onScrollRight={() => scrollStrip(1)}
          />
        ) : null}
      </div>
      <div className="relative -mx-0.5">
        <div
          ref={stripRef}
          className="scrollbar-none flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
        >
          {games.map((g) => (
            <div
              key={g.id}
              className="w-[42vw] max-w-[188px] shrink-0 snap-start sm:max-w-[200px]"
            >
              <RequireAuthLink
                to={`/casino/game-lobby/${encodeURIComponent(g.id)}`}
                className="group game-thumb-link"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-casino-md bg-casino-elevated ring-1 ring-white/[0.06]">
                  <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
                </div>
                <span className="sr-only">{g.title}</span>
              </RequireAuthLink>
            </div>
          ))}
        </div>
      </div>
      {games.length === 0 ? (
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

function ProviderSection({ providers }: { providers: ProviderAgg[] }) {
  const reduceMotion = usePrefersReducedMotion()
  const stripRef = useRef<HTMLDivElement>(null)

  const scrollStrip = useCallback((dir: -1 | 1) => {
    const el = stripRef.current
    if (!el) return
    const step = Math.max(el.clientWidth * 0.65, 220)
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }, [])

  return (
    <section className="mb-7" id="studios">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/casino/games#studios"
          className="group/prov flex min-w-0 flex-1 items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-white sm:text-sm"
        >
          <IconBuilding2 size={17} className="shrink-0 text-white/55 transition-colors group-hover/prov:text-casino-primary" aria-hidden />
          Studios
          <IconChevronRight
            size={18}
            className="shrink-0 text-white/40 transition-colors group-hover/prov:text-casino-primary"
            aria-hidden
          />
        </Link>
        {providers.length > 0 && !reduceMotion ? (
          <ViewAllScrollCluster
            viewAllTo="/casino/games#studios"
            onScrollLeft={() => scrollStrip(-1)}
            onScrollRight={() => scrollStrip(1)}
          />
        ) : providers.length > 0 ? (
          <Link to="/casino/games#studios" className={outlinedViewAllClass}>
            View all
          </Link>
        ) : null}
      </div>
      {providers.length === 0 ? (
        <p className="text-center text-xs text-casino-muted">No studio data yet.</p>
      ) : (
        <div className="relative -mx-0.5" role="region" aria-label="Top studios">
          <div
            ref={stripRef}
            className={
              reduceMotion
                ? 'scrollbar-none flex flex-wrap justify-center gap-3 py-0.5'
                : 'scrollbar-none flex gap-3 overflow-x-auto py-1 [-webkit-overflow-scrolling:touch]'
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
    void (async () => {
      const [f, s, n, l, b, bulk] = await Promise.all([
        fetchGames('integration=blueocean&featured=1&limit=14'),
        fetchGames('integration=blueocean&category=slots&limit=14'),
        fetchGames('integration=blueocean&category=new&limit=14'),
        fetchGames('integration=blueocean&category=live&limit=14'),
        fetchGames('integration=blueocean&category=bonus-buys&limit=14'),
        fetchGames('integration=blueocean&limit=200&sort=provider'),
      ])
      const hotBack = await fetchGames('integration=blueocean&limit=14&sort=new')
      if (cancel) return
      setFeatured(dedupeGamesById(f))
      setHotFallback(dedupeGamesById(hotBack))
      setSlots(dedupeGamesById(s))
      setNewRel(dedupeGamesById(n))
      setLive(dedupeGamesById(l))
      setBonus(dedupeGamesById(b))
      setProviders(aggregateProviders(dedupeGamesById(bulk)))
    })()
    return () => {
      cancel = true
    }
  }, [location.pathname, location.key, visRefresh, catalogSyncAt])

  const logoRowGames = featured.length > 0 ? featured : hotFallback

  return (
    <div className="min-w-0">
      <GameSection title="Hot now" viewAllTo="/casino/challenges" games={logoRowGames} />
      <GameSection title="Slots" viewAllTo="/casino/slots" games={slots} />
      <ProviderSection providers={providers} />
      <GameSection title="New Releases" viewAllTo="/casino/new" games={newRel} />
      <GameSection title="Live Casino" viewAllTo="/casino/live" games={live} />
      <GameSection title="Bonus Buys" viewAllTo="/casino/bonus-buys" games={bonus} />
    </div>
  )
}

export default LobbyHomeSections
