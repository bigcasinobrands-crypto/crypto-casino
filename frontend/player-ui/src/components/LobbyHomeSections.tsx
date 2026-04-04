import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { Link } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { playerApiUrl } from '../lib/playerApiUrl'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
} from './icons'

type Game = {
  id: string
  title: string
  provider: string
  category: string
  thumbnail_url?: string
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
    const code = (g.provider_system || g.provider || '').trim() || 'Other'
    m.set(code, (m.get(code) ?? 0) + 1)
  }
  return [...m.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}

const PortraitThumb: FC<{ url?: string; title: string }> = ({ url, title }) => {
  const [bad, setBad] = useState(false)
  if (!url || bad) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-casino-elevated px-1 text-center text-[10px] text-casino-muted">
        {title}
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="h-full w-full object-cover object-center transition-transform duration-300 ease-out group-hover:scale-[1.04]"
      loading="lazy"
      onError={() => setBad(true)}
    />
  )
}

function GameRowScroller({
  children,
  gameCount,
}: {
  children: React.ReactNode
  gameCount: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = useCallback((dir: -1 | 1) => {
    const el = ref.current
    if (!el) return
    const w = el.clientWidth * 0.85
    el.scrollBy({ left: dir * w, behavior: 'smooth' })
  }, [])

  return (
    <div className="relative">
      <div
        ref={ref}
        className="scrollbar-none -mx-0.5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-6 lg:overflow-visible lg:pb-0"
      >
        {children}
      </div>
      {gameCount > 0 ? (
        <div className="mt-2 flex justify-center gap-2.5 text-casino-muted lg:hidden">
          <button
            type="button"
            className="flex size-3.5 items-center justify-center rounded border border-casino-border/0 p-0 text-casino-muted hover:text-casino-foreground"
            aria-label="Scroll games left"
            onClick={() => scroll(-1)}
          >
            <IconChevronLeft size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="flex size-3.5 items-center justify-center rounded border border-casino-border/0 p-0 text-casino-muted hover:text-casino-foreground"
            aria-label="Scroll games right"
            onClick={() => scroll(1)}
          >
            <IconChevronRight size={14} aria-hidden />
          </button>
        </div>
      ) : null}
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
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          to={viewAllTo}
          className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-casino-foreground hover:text-casino-primary"
        >
          {title}
          <IconChevronRight size={18} className="text-casino-muted" aria-hidden />
        </Link>
        <div className="flex items-center gap-2.5">
          <Link
            to={viewAllTo}
            className="p-0 text-[11px] font-semibold text-casino-foreground underline-offset-2 hover:underline"
          >
            View all
          </Link>
          <div className="hidden items-center gap-2.5 text-casino-muted lg:flex">
            <span className="sr-only">Row navigation</span>
          </div>
        </div>
      </div>
      <GameRowScroller gameCount={games.length}>
        {games.map((g) => (
          <div
            key={g.id}
            className="w-[42vw] max-w-[200px] shrink-0 snap-start lg:max-w-none lg:w-auto lg:shrink"
          >
            <RequireAuthLink
              to={`/casino/game-lobby/${encodeURIComponent(g.id)}`}
              className="group game-thumb-link"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-casino-elevated">
                <PortraitThumb url={g.thumbnail_url} title={g.title} />
              </div>
              <span className="sr-only">{g.title}</span>
            </RequireAuthLink>
          </div>
        ))}
      </GameRowScroller>
      {games.length > 0 ? (
        <Link
          to={viewAllTo}
          className="mt-2.5 flex items-center justify-center gap-1 text-center text-[11px] font-semibold text-casino-muted hover:text-casino-foreground"
        >
          Load more
          <IconChevronDown size={14} aria-hidden />
        </Link>
      ) : (
        <p className="text-center text-xs text-casino-muted">No games in this row yet.</p>
      )}
    </section>
  )
}

function ProviderSection({ providers }: { providers: ProviderAgg[] }) {
  return (
    <section className="mb-7" id="providers">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          to="/casino/games#providers"
          className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-casino-foreground"
        >
          Providers
          <IconChevronRight size={18} className="text-casino-muted" aria-hidden />
        </Link>
        <Link
          to="/casino/games"
          className="p-0 text-[11px] font-semibold text-casino-foreground underline-offset-2 hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {providers.map((p) => (
          <Link
            key={p.code}
            to={`/casino/games?provider=${encodeURIComponent(p.code)}`}
            className="flex aspect-[2.1/1] flex-col items-center justify-center gap-1 rounded-[4px] bg-casino-surface px-2 text-center transition hover:border hover:border-casino-primary/30"
          >
            <span className="text-[11px] font-extrabold tracking-wide text-casino-foreground">
              {p.code.toUpperCase()}
            </span>
            <span className="text-[10px] font-medium text-casino-muted">{p.count} games</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

const LobbyHomeSections: FC = () => {
  const [featured, setFeatured] = useState<Game[]>([])
  const [topGames, setTopGames] = useState<Game[]>([])
  const [slots, setSlots] = useState<Game[]>([])
  const [newRel, setNewRel] = useState<Game[]>([])
  const [live, setLive] = useState<Game[]>([])
  const [bonus, setBonus] = useState<Game[]>([])
  const [providers, setProviders] = useState<ProviderAgg[]>([])

  useEffect(() => {
    let cancel = false
    void (async () => {
      const [f, s, n, l, b, bulk] = await Promise.all([
        fetchGames('integration=blueocean&featured=1&limit=6'),
        fetchGames('integration=blueocean&category=slots&limit=6'),
        fetchGames('integration=blueocean&category=new&limit=6'),
        fetchGames('integration=blueocean&category=live&limit=6'),
        fetchGames('integration=blueocean&category=bonus-buys&limit=6'),
        fetchGames('integration=blueocean&limit=200&sort=provider'),
      ])
      const top = await fetchGames('integration=blueocean&limit=6&sort=name')
      if (cancel) return
      setFeatured(f)
      setTopGames(top)
      setSlots(s)
      setNewRel(n)
      setLive(l)
      setBonus(b)
      setProviders(aggregateProviders(bulk))
    })()
    return () => {
      cancel = true
    }
  }, [])

  const logoRowGames = featured.length > 0 ? featured : topGames

  return (
    <div className="min-w-0">
      <GameSection title="Hot now" viewAllTo="/casino/featured" games={logoRowGames} />
      <GameSection title="Slots" viewAllTo="/casino/slots" games={slots} />
      <ProviderSection providers={providers} />
      <GameSection title="New Releases" viewAllTo="/casino/new" games={newRel} />
      <GameSection title="Live Casino" viewAllTo="/casino/live" games={live} />
      <GameSection title="Bonus Buys" viewAllTo="/casino/bonus-buys" games={bonus} />
    </div>
  )
}

export default LobbyHomeSections
