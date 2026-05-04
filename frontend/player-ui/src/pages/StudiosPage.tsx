import { useEffect, useLayoutEffect, useMemo, useState, useId, type FC } from 'react'
import { Link } from 'react-router-dom'
import { useCompleteInitialLoad } from '../context/InitialAppLoadContext'
import { CATALOG_SEARCH_SHELL_ROW } from '../components/CasinoCatalogSearchStrip'
import { IconSearch } from '../components/icons'
import { playerApiOriginConfigured, playerApiUrl } from '../lib/playerApiUrl'
import { STUDIO_MARQUEE_LOGOS, type StudioMarqueeLogo } from '../lib/studioMarqueeLogos'
import { countGamesPerStudio } from '../lib/studioProviderCounts'

type CatalogGame = {
  provider?: string
  provider_system?: string
}

async function fetchCatalogForCounts(): Promise<CatalogGame[]> {
  const path = '/v1/games?integration=blueocean&limit=500&sort=provider'
  const url = playerApiUrl(path)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      if (import.meta.env.DEV) {
        const hint = !playerApiOriginConfigured()
          ? ' Hint: set VITE_PLAYER_API_ORIGIN so /v1 hits the API.'
          : ''
        console.warn(`[studios] GET ${path} → ${res.status}${hint}`, url)
      }
      return []
    }
    const j = (await res.json()) as { games?: CatalogGame[] }
    return j.games ?? []
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[studios] catalog fetch failed', url, e)
    }
    return []
  }
}

const StudiosPage: FC = () => {
  const completeInitialLoad = useCompleteInitialLoad()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [countsById, setCountsById] = useState<Record<string, number> | null>(null)

  useLayoutEffect(() => {
    completeInitialLoad()
  }, [completeInitialLoad])

  useEffect(() => {
    let cancel = false
    void (async () => {
      const games = await fetchCatalogForCounts()
      if (cancel) return
      setCountsById(countGamesPerStudio(games))
    })()
    return () => {
      cancel = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [...STUDIO_MARQUEE_LOGOS]
    return STUDIO_MARQUEE_LOGOS.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        l.providerQuery.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q),
    )
  }, [query])

  return (
    <div className="player-casino-max relative min-w-0 shrink-0 flex-1 px-4 pb-16 pt-5 sm:px-5 md:px-6 lg:px-8">
      <header className="mb-5 flex min-h-[2.5rem] items-start justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Studios</h1>
      </header>

      <div className={`${CATALOG_SEARCH_SHELL_ROW} mb-6 w-full max-w-full min-[480px]:max-w-xl`}>
        <IconSearch size={17} className="shrink-0 text-white/48" aria-hidden />
        <input
          id={`${searchId}-studios-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search studios"
          autoComplete="off"
          aria-label="Search studios"
          className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[13px] font-medium text-white placeholder:text-white/42 focus:outline-none focus:ring-0"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-casino-muted">No studios match your search.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-3.5 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {filtered.map((logo) => (
            <li key={logo.id} className="min-w-0">
              <StudioPublisherCard logo={logo} gameCount={countsById?.[logo.id]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StudioPublisherCard({
  logo,
  gameCount,
}: {
  logo: StudioMarqueeLogo
  gameCount: number | undefined
}) {
  const href = `/casino/games?provider=${encodeURIComponent(logo.providerQuery)}`
  const countLabel =
    gameCount === undefined ? (
      <span className="tabular-nums text-white/38">…</span>
    ) : (
      <span className="tabular-nums text-white/55">{gameCount.toLocaleString()} games</span>
    )

  return (
    <div className="flex flex-col gap-2">
      <Link
        to={href}
        className="group flex aspect-[5/4] min-h-[100px] w-full flex-col items-center justify-center rounded-[10px] border border-white/[0.09] bg-casino-surface p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-casino-primary/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 sm:aspect-[4/3] sm:min-h-[112px]"
        aria-label={`${logo.label} — browse games`}
      >
        <img
          src={logo.src}
          alt=""
          draggable={false}
          className={`max-h-[36px] w-auto max-w-[min(100%,9rem)] object-contain opacity-[0.95] sm:max-h-[40px] ${logo.forceWhiteFilter ? 'brightness-0 invert' : ''}`}
          loading="lazy"
          decoding="async"
        />
      </Link>
      <div className="flex items-center gap-1.5 px-0.5 text-[11px] leading-tight">
        <span
          className="size-1.5 shrink-0 rounded-full bg-emerald-400/90 shadow-[0_0_6px_rgba(52,211,153,0.45)]"
          aria-hidden
        />
        {countLabel}
      </div>
    </div>
  )
}

export default StudiosPage
