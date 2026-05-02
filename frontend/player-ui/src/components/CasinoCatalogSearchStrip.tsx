import type { FC, ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import { IconBanknote, IconGem, IconRadio, IconSearch, IconSparkles, IconZap } from './icons'

const SEARCH_DEBOUNCE_MS = 360

type NavItem = {
  key: string
  to: string
  label: string
  icon: FC<{ size?: number; className?: string }>
  isActive: (ctx: StripContext) => boolean
}

type StripContext = {
  pathname: string
  lobbyDashboardHome: boolean
}

/** Charcoal trays on black canvas (vybebet / Pigmo chrome). */
const stripTray =
  'rounded-[10px] border border-white/[0.09] bg-casino-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
const searchTrayInteractive = `${stripTray} transition-[border-color,box-shadow] duration-200 hover:border-white/[0.12]`
const searchShellFocus =
  'focus-within:border-casino-primary/40 focus-within:ring-[3px] focus-within:ring-casino-primary/18'

/** Same tray chrome as the search cell in {@link CasinoCatalogSearchStrip} (home row). */
export const CATALOG_SEARCH_SHELL_ROW =
  `${searchTrayInteractive} ${searchShellFocus} flex min-h-[44px] min-w-0 items-center gap-2.5 px-3.5 py-2.5`

/** Matches home `sm:flex-row` strip: two `flex-1` tracks + `gap-2.5` → each track ≈ `(100% - 0.625rem) / 2`. */
export const CATALOG_SEARCH_HOME_COLUMN_MAX_W = 'max-w-full sm:max-w-[calc((100%-0.625rem)/2)]'

/** Catalog-only shortcuts (no Lobby / Studios strip). Matches Pigmo-style game menu. */
const NAV: NavItem[] = [
  {
    key: 'hot',
    to: '/casino/games',
    label: 'Hot now',
    icon: IconZap,
    isActive: ({ lobbyDashboardHome }) => lobbyDashboardHome,
  },
  {
    key: 'new',
    to: '/casino/new',
    label: 'New releases',
    icon: IconSparkles,
    isActive: ({ pathname }) => pathname.endsWith('/casino/new'),
  },
  {
    key: 'slots',
    to: '/casino/slots',
    label: 'Slots',
    icon: IconGem,
    isActive: ({ pathname }) => pathname.endsWith('/casino/slots'),
  },
  {
    key: 'bonus',
    to: '/casino/bonus-buys',
    label: 'Bonus buys',
    icon: IconBanknote,
    isActive: ({ pathname }) => pathname.includes('/casino/bonus-buys'),
  },
  {
    key: 'live',
    to: '/casino/live',
    label: 'Live games',
    icon: IconRadio,
    isActive: ({ pathname }) => pathname.endsWith('/casino/live'),
  },
]

const pillBase =
  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[12px] font-bold tracking-tight no-underline outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-casino-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#000] [&_svg]:shrink-0'
const pillIdle =
  'text-white/[0.88] hover:bg-white/[0.08] hover:text-white active:bg-white/[0.11] [&_svg]:text-white/[0.88] hover:[&_svg]:text-white'
const pillActive =
  'bg-casino-primary text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-casino-primary-dim hover:text-white active:brightness-[0.95] [&_svg]:text-white'

export type CasinoCatalogNavPillsProps = {
  pathname: string
  /** Mirrors `LobbyPage` dashboard state (minimal query on `/casino/games`). */
  lobbyDashboardHome: boolean
  className?: string
}

/** Hot now / New / Slots / Bonus buys / Live — full-width category row. */
export const CasinoCatalogNavPills: FC<CasinoCatalogNavPillsProps> = ({
  pathname,
  lobbyDashboardHome,
  className = 'mb-4',
}) => {
  const ctx: StripContext = { pathname, lobbyDashboardHome }

  return (
    <nav
      className={`${stripTray} casino-catalog-pills-row flex min-h-[44px] min-w-0 w-full items-center gap-1 px-1 py-1 sm:gap-1.5 ${className}`}
      aria-label="Game categories"
    >
      {NAV.map((item) => {
        const active = item.isActive(ctx)
        const Ic = item.icon
        const content: ReactNode = (
          <>
            <Ic size={15} className="shrink-0 opacity-90" aria-hidden />
            <span>{item.label}</span>
          </>
        )
        return (
          <RequireAuthLink
            key={item.key}
            to={item.to}
            className={`${pillBase} ${active ? pillActive : pillIdle}`}
            aria-current={active ? 'page' : undefined}
          >
            {content}
          </RequireAuthLink>
        )
      })}
    </nav>
  )
}

export type CasinoCatalogSearchFieldProps = {
  className?: string
  /**
   * When true (catalog section pages), wrap with the same max-width as the search column on the home
   * strip (`flex-1` beside pills) so visuals match — only position differs.
   */
  matchHomeStripColumnWidth?: boolean
}

/** Debounced `q` query sync — place under section title / counts, above the game grid. */
export const CasinoCatalogSearchField: FC<CasinoCatalogSearchFieldProps> = ({
  className = 'mb-4',
  matchHomeStripColumnWidth = false,
}) => {
  const id = useId()
  const [searchParams, setSearchParams] = useSearchParams()
  const qParam = searchParams.get('q') ?? ''
  const [draftQ, setDraftQ] = useState(qParam)

  useEffect(() => {
    setDraftQ(qParam)
  }, [qParam])

  useEffect(() => {
    const t = window.setTimeout(() => {
      const nextQ = draftQ.trim()
      if (nextQ === qParam.trim()) return
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (nextQ) next.set('q', nextQ)
          else next.delete('q')
          return next
        },
        { replace: true },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [draftQ, qParam, setSearchParams])

  const shellRowClass = `${CATALOG_SEARCH_SHELL_ROW} w-full min-w-0`

  const inner = (
    <>
      <IconSearch size={17} className="shrink-0 text-white/48" aria-hidden />
      <input
        id={`${id}-catalog-search`}
        type="search"
        value={draftQ}
        onChange={(e) => setDraftQ(e.target.value)}
        placeholder="Search titles or studios"
        autoComplete="off"
        aria-label="Search games by title or studio"
        className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[13px] font-medium text-white placeholder:text-white/42 focus:outline-none focus:ring-0"
      />
    </>
  )

  if (matchHomeStripColumnWidth) {
    return (
      <div className={`min-w-0 w-full ${CATALOG_SEARCH_HOME_COLUMN_MAX_W} ${className}`}>
        <div className={shellRowClass}>{inner}</div>
      </div>
    )
  }

  return <div className={`${shellRowClass} ${className}`}>{inner}</div>
}

export type CasinoCatalogSearchStripProps = {
  pathname: string
  lobbyDashboardHome: boolean
}

/** Home dashboard (`/casino/games`): search + category pills on one row. Section catalog pages use {@link CasinoCatalogNavPills} + {@link CasinoCatalogSearchField} separately. */
const CasinoCatalogSearchStrip: FC<CasinoCatalogSearchStripProps> = ({ pathname, lobbyDashboardHome }) => (
  <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2.5">
    <CasinoCatalogSearchField className="mb-0 flex-1 sm:min-w-0" />
    <CasinoCatalogNavPills
      pathname={pathname}
      lobbyDashboardHome={lobbyDashboardHome}
      className="mb-0 min-w-0 flex-1 sm:min-w-0"
    />
  </div>
)

export default CasinoCatalogSearchStrip
