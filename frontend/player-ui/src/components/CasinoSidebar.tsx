import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { RequireAuthNavLink } from './RequireAuthNavLink'
import { useSiteContent } from '../hooks/useSiteContent'
import {
  IconBanknote,
  IconBuilding2,
  IconChevronDown,
  IconClock,
  IconCrown,
  IconDices,
  IconFileText,
  IconGem,
  IconGift,
  IconGlobe,
  IconHeadphones,
  IconPanelLeftClose,
  IconPanelLeftOpen,
  IconRadio,
  IconSparkles,
  IconStar,
  IconSwords,
  IconTarget,
  IconTicket,
  IconTractor,
  IconTrophy,
  IconUsers,
} from './icons'

type CasinoSidebarProps = {
  mobileOpen: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

type NavCategory = {
  id: string
  label: string
  enabled: boolean
  coming_soon?: boolean
}

const ICON_MAP: Record<string, (size: number) => ReactNode> = {
  hot_now: (s) => <IconSwords size={s} aria-hidden />,
  new_releases: (s) => <IconSparkles size={s} aria-hidden />,
  slots: (s) => <IconGem size={s} aria-hidden />,
  bonus_buys: (s) => <IconBanknote size={s} aria-hidden />,
  live: (s) => <IconRadio size={s} aria-hidden />,
  challenges: (s) => <IconTarget size={s} aria-hidden />,
  favourites: (s) => <IconStar size={s} aria-hidden />,
  recently_played: (s) => <IconClock size={s} aria-hidden />,
  providers: (s) => <IconBuilding2 size={s} aria-hidden />,
  sports: (s) => <IconTrophy size={s} aria-hidden />,
  rewards: (s) => <IconGift size={s} aria-hidden />,
  affiliate: (s) => <IconUsers size={s} aria-hidden />,
  vip: (s) => <IconCrown size={s} aria-hidden />,
  farming: (s) => <IconTractor size={s} aria-hidden />,
  raffle: (s) => <IconTicket size={s} aria-hidden />,
}

const ROUTE_MAP: Record<string, string> = {
  hot_now: '/casino/games',
  new_releases: '/casino/new',
  slots: '/casino/slots',
  bonus_buys: '/casino/bonus-buys',
  live: '/casino/live',
  challenges: '/casino/challenges',
  favourites: '/casino/favourites',
  recently_played: '/casino/recent',
  providers: '/casino/games#providers',
  sports: '/casino/sports',
  rewards: '/rewards',
  affiliate: '',
  vip: '/vip',
  farming: '',
  raffle: '/casino/games',
}

const FALLBACK_CASINO_ITEMS: NavCategory[] = [
  { id: 'hot_now', label: 'Hot now', enabled: true },
  { id: 'new_releases', label: 'New Releases', enabled: true },
  { id: 'slots', label: 'Slots', enabled: true },
  { id: 'bonus_buys', label: 'Bonus Buys', enabled: true },
  { id: 'live', label: 'Live', enabled: true },
  { id: 'challenges', label: 'Challenges', enabled: true },
  { id: 'favourites', label: 'Favourites', enabled: true },
  { id: 'recently_played', label: 'Recently Played', enabled: true },
  { id: 'providers', label: 'Providers', enabled: true },
]

const FALLBACK_EXTRAS: NavCategory[] = [{ id: 'sports', label: 'Sports', enabled: true }]

const FALLBACK_PROMO: NavCategory[] = [
  { id: 'rewards', label: 'Rewards', enabled: true },
  { id: 'affiliate', label: 'Affiliate', enabled: true, coming_soon: true },
  { id: 'vip', label: 'VIP', enabled: true },
  { id: 'farming', label: 'Farming', enabled: true, coming_soon: true },
  { id: 'raffle', label: '$25K Raffle', enabled: true },
]

function isHotNow(id: string) { return id === 'hot_now' }
function isProviders(id: string) { return id === 'providers' }

export default function CasinoSidebar({ mobileOpen, onClose, collapsed, onToggleCollapse }: CasinoSidebarProps) {
  const [casinoOpen, setCasinoOpen] = useState(true)
  const { pathname, hash } = useLocation()
  const { getContent } = useSiteContent()

  const casinoItems = getContent<NavCategory[]>('nav.categories.casino', FALLBACK_CASINO_ITEMS)
    .filter((c) => c.enabled !== false)
  const extraItems = getContent<NavCategory[]>('nav.categories.extras', FALLBACK_EXTRAS)
    .filter((c) => c.enabled !== false)
  const promoItems = getContent<NavCategory[]>('nav.categories.promo', FALLBACK_PROMO)
    .filter((c) => c.enabled !== false)

  const onGamesCatalog = pathname === '/casino/games'
  const hotNowSidebarActive = onGamesCatalog && hash === ''
  const providersSidebarActive = onGamesCatalog && hash === '#providers'
  const helpSidebarActive = onGamesCatalog && hash === '#help'
  const blogSidebarActive = onGamesCatalog && hash === '#blog'

  const closeIfMobile = () => {
    if (window.matchMedia('(max-width: 1023px)').matches) onClose()
  }

  const navItem = collapsed
    ? 'flex w-full items-center justify-center rounded-[6px] p-2.5 text-casino-muted transition hover:bg-casino-elevated/60 hover:text-casino-foreground'
    : 'flex w-full items-center justify-between rounded-[4px] px-3 py-2.5 text-left text-[13px] font-semibold text-casino-muted transition hover:bg-casino-elevated/60 hover:text-casino-foreground'

  const navItemActive =
    'bg-casino-primary-dim text-casino-foreground hover:bg-casino-primary-dim/90 hover:text-casino-foreground'

  const subLink =
    'flex w-full items-center gap-2.5 rounded-[4px] py-1.5 pl-2.5 pr-2 text-left text-[12px] font-medium text-casino-muted transition hover:bg-casino-elevated/50 hover:text-casino-foreground'
  const subActive =
    'bg-casino-primary-dim font-medium text-casino-foreground hover:bg-casino-primary-dim/90 hover:text-casino-foreground'

  const icon = (id: string, size: number) => (ICON_MAP[id] ?? (() => null))(size)

  const renderSubItem = (item: NavCategory) => {
    const route = ROUTE_MAP[item.id] ?? ''
    const isEnd = isHotNow(item.id)
    const activeOverride = isHotNow(item.id)
      ? hotNowSidebarActive
      : isProviders(item.id)
        ? providersSidebarActive
        : undefined

    if (!route || item.coming_soon) {
      return (
        <span key={item.id} className={`${subLink} cursor-default opacity-45`} title={item.coming_soon ? 'Coming soon' : undefined}>
          {icon(item.id, 15)}
          {item.label}
        </span>
      )
    }

    if (activeOverride !== undefined) {
      return (
        <NavLink
          key={item.id}
          to={route}
          end={isEnd}
          className={`${subLink} ${activeOverride ? subActive : ''}`}
        >
          {icon(item.id, 15)}
          {item.label}
        </NavLink>
      )
    }

    return (
      <RequireAuthNavLink
        key={item.id}
        to={route}
        className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}
      >
        {icon(item.id, 15)}
        {item.label}
      </RequireAuthNavLink>
    )
  }

  const renderTopItem = (item: NavCategory) => {
    const route = ROUTE_MAP[item.id] ?? ''
    const publicPromo = item.id === 'vip' || item.id === 'sports'
    if (!route || item.coming_soon) {
      if (collapsed) {
        return (
          <span key={item.id} className={navItem} title={`${item.label}${item.coming_soon ? ' (coming soon)' : ''}`}>
            {icon(item.id, 15)}
          </span>
        )
      }
      return (
        <span key={item.id} className={`${navItem} cursor-default opacity-45`} title={item.coming_soon ? 'Coming soon' : undefined}>
          <span className="flex items-center gap-2.5">
            {icon(item.id, 15)}
            {item.label}
          </span>
        </span>
      )
    }

    if (collapsed) {
      if (publicPromo) {
        return (
          <NavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`} title={item.label}>
            {icon(item.id, 15)}
          </NavLink>
        )
      }
      return (
        <RequireAuthNavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`} title={item.label}>
          {icon(item.id, 15)}
        </RequireAuthNavLink>
      )
    }

    if (publicPromo) {
      return (
        <NavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`}>
          <span className="flex items-center gap-2.5">
            {icon(item.id, 15)}
            {item.label}
          </span>
        </NavLink>
      )
    }

    return (
      <RequireAuthNavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`}>
        <span className="flex items-center gap-2.5">
          {icon(item.id, 15)}
          {item.label}
        </span>
      </RequireAuthNavLink>
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] transition-opacity lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh shrink-0 flex-col border-r border-casino-border bg-casino-sidebar transition-[transform,width] duration-200 ease-out lg:static lg:z-0 lg:h-full lg:max-h-full lg:min-h-0 lg:translate-x-0 ${
          collapsed ? 'w-[52px]' : 'w-[240px]'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Collapse toggle — desktop only */}
        <div className={`hidden h-16 shrink-0 items-center border-b border-casino-border lg:flex ${collapsed ? 'justify-center px-2' : 'px-3'}`}>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] bg-white/[0.04] text-casino-muted shadow-sm transition hover:bg-casino-primary-dim hover:text-white"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconPanelLeftOpen size={18} /> : <IconPanelLeftClose size={18} />}
          </button>
        </div>

        <nav
          className={`scrollbar-none flex flex-1 flex-col gap-1 overflow-y-auto pb-5 pt-3 ${
            collapsed ? 'items-center px-1.5' : 'px-3'
          }`}
          onClick={closeIfMobile}
        >
          {/* Casino section */}
          <div>
            {collapsed ? (
              <NavLink
                to="/casino/games"
                end
                className={`${navItem} ${hotNowSidebarActive ? navItemActive : ''}`}
                title="Casino"
              >
                <IconDices size={15} className="shrink-0" aria-hidden />
              </NavLink>
            ) : (
              <button
                type="button"
                className={`${navItem} ${casinoOpen ? navItemActive : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setCasinoOpen((o) => !o)
                }}
                aria-expanded={casinoOpen}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <IconDices size={15} className="shrink-0" aria-hidden />
                  Casino
                </span>
                <IconChevronDown
                  size={15}
                  className={`shrink-0 transition ${casinoOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
            )}

            {!collapsed && casinoOpen ? (
              <div className="mb-2 ml-3.5 mt-0.5 flex flex-col gap-0.5 border-l border-casino-border/40 pl-2">
                {casinoItems.map(renderSubItem)}
              </div>
            ) : null}
          </div>

          {extraItems.map(renderTopItem)}

          <div className={`my-2.5 h-px bg-casino-border ${collapsed ? 'w-full' : ''}`} role="separator" />

          {collapsed ? (
            <>
              {promoItems.map(renderTopItem)}

              <div className="my-2.5 h-px w-full bg-casino-border" role="separator" />

              <button type="button" className={navItem} title="Language">
                <IconGlobe size={15} aria-hidden />
              </button>
              <NavLink
                to="/casino/games#help"
                className={`${navItem} ${helpSidebarActive ? navItemActive : ''}`}
                title="Live Support"
              >
                <IconHeadphones size={15} aria-hidden />
              </NavLink>
              <NavLink
                to="/casino/games#blog"
                className={`${navItem} ${blogSidebarActive ? navItemActive : ''}`}
                title="Blog"
              >
                <IconFileText size={15} aria-hidden />
              </NavLink>
            </>
          ) : (
            <>
              {promoItems.map(renderTopItem)}

              <div className="my-2.5 h-px bg-casino-border" role="separator" />

              <button type="button" className={navItem}>
                <span className="flex items-center gap-2.5">
                  <IconGlobe size={15} aria-hidden />
                  Language
                </span>
                <IconChevronDown size={15} aria-hidden />
              </button>
              <NavLink
                to="/casino/games#help"
                className={`${navItem} ${helpSidebarActive ? navItemActive : ''}`}
              >
                <span className="flex items-center gap-2.5">
                  <IconHeadphones size={15} aria-hidden />
                  Live Support
                </span>
              </NavLink>
              <NavLink
                to="/casino/games#blog"
                className={`${navItem} ${blogSidebarActive ? navItemActive : ''}`}
              >
                <span className="flex items-center gap-2.5">
                  <IconFileText size={15} aria-hidden />
                  Blog
                </span>
              </NavLink>
            </>
          )}
        </nav>
      </aside>
    </>
  )
}
