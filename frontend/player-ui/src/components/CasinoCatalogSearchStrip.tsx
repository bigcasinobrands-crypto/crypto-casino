import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { usePlayerLayout } from '../context/PlayerLayoutContext'
import { RequireAuthLink } from './RequireAuthLink'
import {
  IconBanknote,
  IconChevronLeft,
  IconChevronRight,
  IconGem,
  IconRadio,
  IconSearch,
  IconSparkles,
  IconZap,
} from './icons'

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

const pillBase =
  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[12px] font-bold tracking-tight no-underline outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-casino-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#000] [&_svg]:shrink-0'
const pillBaseCompact =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-bold tracking-tight no-underline outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-casino-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#000] [&_svg]:shrink-0'
const pillIdle =
  'text-white/[0.88] hover:bg-white/[0.08] hover:text-white active:bg-white/[0.11] [&_svg]:text-white/[0.88] hover:[&_svg]:text-white'
const pillActive =
  'bg-casino-primary text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-casino-primary-dim hover:text-white active:brightness-[0.95] [&_svg]:text-white'

export type CasinoCatalogNavPillsProps = {
  pathname: string
  /** Mirrors `LobbyPage` dashboard state (minimal query on `/casino/games`). */
  lobbyDashboardHome: boolean
  className?: string
  /** Tighter pills when the main column is narrow (e.g. Global Chat open). */
  compact?: boolean
  /** `embedded`: sits inside a parent horizontal scroller — disable nested strip overflow. */
  stripLayout?: 'default' | 'embedded'
}

/** Hot now / New / Slots / Bonus buys / Live — full-width category row. */
export const CasinoCatalogNavPills: FC<CasinoCatalogNavPillsProps> = ({
  pathname,
  lobbyDashboardHome,
  className = 'mb-4',
  compact = false,
  stripLayout = 'default',
}) => {
  const { t } = useTranslation()
  const navItems = useMemo(
    (): NavItem[] => [
      {
        key: 'hot',
        to: '/casino/games',
        label: t('nav.casino.hot_now'),
        icon: IconZap,
        isActive: ({ lobbyDashboardHome: home }) => home,
      },
      {
        key: 'new',
        to: '/casino/new',
        label: t('nav.casino.new_releases'),
        icon: IconSparkles,
        isActive: ({ pathname: p }) => p.endsWith('/casino/new'),
      },
      {
        key: 'slots',
        to: '/casino/slots',
        label: t('nav.casino.slots'),
        icon: IconGem,
        isActive: ({ pathname: p }) => p.endsWith('/casino/slots'),
      },
      {
        key: 'bonus',
        to: '/casino/bonus-buys',
        label: t('nav.casino.bonus_buys'),
        icon: IconBanknote,
        isActive: ({ pathname: p }) => p.includes('/casino/bonus-buys'),
      },
      {
        key: 'live',
        to: '/casino/live',
        label: t('lobby.catalogLiveGames'),
        icon: IconRadio,
        isActive: ({ pathname: p }) => p.endsWith('/casino/live'),
      },
    ],
    [t],
  )

  const ctx: StripContext = { pathname, lobbyDashboardHome }
  const pillSz = compact ? pillBaseCompact : pillBase
  const iconSize = compact ? 13 : 15
  const trayMin = compact ? 'min-h-[40px]' : 'min-h-[44px]'
  const navTrayClass =
    stripLayout === 'embedded'
      ? `${stripTray} flex ${trayMin} w-max max-w-none flex-nowrap items-center gap-1 px-1 py-1 sm:gap-1.5`
      : `${stripTray} casino-catalog-pills-row flex ${trayMin} min-w-0 w-full items-center gap-1 px-1 py-1 sm:gap-1.5`

  return (
    <nav className={`${navTrayClass} ${className}`} aria-label={t('lobby.categoriesAriaLabel')}>
      {navItems.map((item) => {
        const active = item.isActive(ctx)
        const Ic = item.icon
        const content: ReactNode = (
          <>
            <Ic size={iconSize} className="shrink-0 opacity-90" aria-hidden />
            <span>{item.label}</span>
          </>
        )
        return (
          <RequireAuthLink
            key={item.key}
            to={item.to}
            className={`${pillSz} ${active ? pillActive : pillIdle}`}
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
  /** Shorter tray + type size when the home strip is compressed (e.g. chat open). */
  compact?: boolean
}

/** Debounced `q` query sync — place under section title / counts, above the game grid. */
export const CasinoCatalogSearchField: FC<CasinoCatalogSearchFieldProps> = ({
  className = 'mb-4',
  matchHomeStripColumnWidth = false,
  compact = false,
}) => {
  const { t } = useTranslation()
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

  const shellRowClass = compact
    ? `${searchTrayInteractive} ${searchShellFocus} flex min-h-[40px] min-w-0 items-center gap-2 px-3 py-2 w-full`
    : `${CATALOG_SEARCH_SHELL_ROW} w-full min-w-0`

  const inner = (
    <>
      <IconSearch size={compact ? 15 : 17} className="shrink-0 text-white/48" aria-hidden />
      <input
        id={`${id}-catalog-search`}
        type="search"
        value={draftQ}
        onChange={(e) => setDraftQ(e.target.value)}
        placeholder={t('lobby.searchPlaceholder')}
        autoComplete="off"
        aria-label={t('lobby.searchAriaLabel')}
        className={`min-w-0 flex-1 border-0 bg-transparent py-1 font-medium text-white placeholder:text-white/42 focus:outline-none focus:ring-0 ${compact ? 'text-[12px]' : 'text-[13px]'}`}
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

const stripScrollBtn =
  'hidden h-10 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.10] bg-casino-surface text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 sm:inline-flex'

/** Home + catalog section pages: search + category pills on one row (`sm:flex-row`), same chrome and debounced `q` sync. */
const CasinoCatalogSearchStrip: FC<CasinoCatalogSearchStripProps> = ({ pathname, lobbyDashboardHome }) => {
  const { t } = useTranslation()
  const { chatOpen } = usePlayerLayout()
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollStripBy = useCallback((dir: -1 | 1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({
      left: dir * Math.max(160, el.clientWidth * 0.55),
      behavior: 'smooth',
    })
  }, [])

  if (!chatOpen) {
    return (
      <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2.5">
        {/*
          Search flexes and shrinks first; pills stay intrinsic width so all category buttons stay visible
          (avoid equal flex-1 columns that squeeze the pill tray).
        */}
        <CasinoCatalogSearchField className="mb-0 min-w-0 w-full flex-1 sm:min-w-[12rem]" />
        <CasinoCatalogNavPills
          pathname={pathname}
          lobbyDashboardHome={lobbyDashboardHome}
          className="mb-0 min-w-0 w-full sm:w-max sm:shrink-0 sm:flex-none"
        />
      </div>
    )
  }

  return (
    <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-1.5">
      <button
        type="button"
        className={stripScrollBtn}
        aria-label={t('lobby.scrollSearchFiltersLeft')}
        onClick={() => scrollStripBy(-1)}
      >
        <IconChevronLeft size={16} aria-hidden />
      </button>
      <div
        ref={scrollRef}
        className="scrollbar-none flex min-w-0 flex-1 flex-col gap-2 overflow-x-visible sm:flex-row sm:gap-2.5 sm:overflow-x-auto sm:overscroll-x-contain sm:py-0.5"
      >
        <CasinoCatalogSearchField
          compact
          className="mb-0 min-w-0 w-full shrink-0 sm:min-w-[8rem] sm:max-w-none sm:flex-1"
        />
        <CasinoCatalogNavPills
          pathname={pathname}
          lobbyDashboardHome={lobbyDashboardHome}
          compact
          stripLayout="embedded"
          className="mb-0 min-w-0 w-full sm:w-max sm:shrink-0"
        />
      </div>
      <button
        type="button"
        className={stripScrollBtn}
        aria-label={t('lobby.scrollSearchFiltersRight')}
        onClick={() => scrollStripBy(1)}
      >
        <IconChevronRight size={16} aria-hidden />
      </button>
    </div>
  )
}

export default CasinoCatalogSearchStrip
