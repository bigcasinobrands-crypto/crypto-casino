import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { RequireAuthNavLink } from './RequireAuthNavLink'
import { useSiteContent } from '../hooks/useSiteContent'
import HeaderCasinoSportsSegment from './HeaderCasinoSportsSegment'
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
  IconMenu,
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
  providers: '/casino/games#studios',
  sports: '/casino/sports',
  rewards: '/bonuses',
  affiliate: '',
  vip: '/vip',
  farming: '',
  raffle: '/casino/games#raffle',
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
  { id: 'providers', label: 'Studios', enabled: true },
]

const FALLBACK_EXTRAS: NavCategory[] = [{ id: 'sports', label: 'Sports', enabled: true }]

const FALLBACK_PROMO: NavCategory[] = [
  { id: 'rewards', label: 'My Bonuses', enabled: true },
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
  const providersSidebarActive = onGamesCatalog && (hash === '#studios' || hash === '#providers')
  const helpSidebarActive = onGamesCatalog && hash === '#help'
  const blogSidebarActive = onGamesCatalog && hash === '#blog'
  const raffleSidebarActive = onGamesCatalog && hash === '#raffle'

  const closeIfMobile = () => {
    if (window.matchMedia('(max-width: 1023px)').matches) onClose()
  }

  const navItem = collapsed
    ? 'flex w-full items-center justify-center rounded-lg p-2.5 text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground'
    : 'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground [&_svg]:text-casino-primary/88'

  const navItemActive =
    'bg-casino-primary/22 text-white hover:bg-casino-primary/30 [&_svg]:text-casino-primary'

  const casinoSectionHeaderBtn =
    'flex w-full items-center justify-between rounded-2xl px-3.5 py-3 text-left text-[13px] font-bold text-white transition'
  const casinoSectionHeaderOpen =
    'bg-casino-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:brightness-110'
  const casinoSectionHeaderClosed = 'bg-casino-primary-dim hover:bg-casino-primary'

  const subLink =
    'flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-2.5 pr-2 text-left text-[12px] font-medium text-casino-muted transition hover:bg-white/[0.04] hover:text-casino-foreground [&_svg]:shrink-0 [&_svg]:text-casino-primary/88'
  const subActive =
    'bg-casino-primary/22 font-semibold text-white hover:bg-casino-primary/28 [&_svg]:text-casino-primary'

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

    if (item.id === 'raffle' && route && !item.coming_soon) {
      const raffleCollapsedCls = raffleSidebarActive
        ? 'flex w-full items-center justify-center rounded-xl bg-casino-primary p-2.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 [&_svg]:text-white'
        : 'flex w-full items-center justify-center rounded-xl border border-white/[0.06] bg-casino-surface p-2.5 text-casino-muted transition hover:bg-casino-chip-hover hover:text-casino-foreground [&_svg]:text-casino-primary'
      const raffleExpandedCls = raffleSidebarActive
        ? 'mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-casino-primary px-3 py-2.5 text-[13px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition hover:brightness-110 [&_svg]:text-white'
        : 'mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-casino-surface px-3 py-2.5 text-[13px] font-bold text-casino-foreground transition hover:bg-casino-chip-hover [&_svg]:text-casino-primary'
      if (collapsed) {
        return (
          <NavLink
            key={item.id}
            to={route}
            className={raffleCollapsedCls}
            title={item.label}
          >
            <IconTicket size={15} aria-hidden />
          </NavLink>
        )
      }
      return (
        <NavLink
          key={item.id}
          to={route}
          className={raffleExpandedCls}
        >
          {icon(item.id, 15)}
          {item.label}
        </NavLink>
      )
    }

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
        className={`fixed inset-0 z-40 bg-black/75 backdrop-blur-[3px] transition-opacity lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh shrink-0 flex-col border-r border-white/[0.06] bg-casino-sidebar transition-[transform,width] duration-200 ease-out lg:static lg:z-0 lg:h-full lg:max-h-full lg:min-h-0 lg:translate-x-0 ${
          collapsed ? 'w-[52px]' : 'w-[240px]'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Sidebar chrome: collapse + Casino/Sports (same strip as before layout refactor; colours match brand) */}
        <div className="shrink-0 border-b border-white/[0.06] bg-casino-sidebar px-0.5 pt-2 pb-2">
          {collapsed ? (
            <div className="flex h-14 items-center justify-center px-2">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover"
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
                title="Expand sidebar"
              >
                <IconPanelLeftOpen size={18} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2">
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover lg:hidden"
                onClick={onClose}
                aria-label="Close menu"
              >
                <IconMenu size={18} aria-hidden />
              </button>
              <button
                type="button"
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover lg:inline-flex"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <IconPanelLeftClose size={18} aria-hidden />
              </button>
              <HeaderCasinoSportsSegment className="min-w-0 flex-1" onNavigate={closeIfMobile} />
            </div>
          )}
        </div>

        <nav
          className={`scrollbar-none flex flex-1 flex-col gap-1 overflow-y-auto pb-8 pt-4 ${
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
                className={`${casinoSectionHeaderBtn} ${casinoOpen ? casinoSectionHeaderOpen : casinoSectionHeaderClosed}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setCasinoOpen((o) => !o)
                }}
                aria-expanded={casinoOpen}
              >
                <span className="flex min-w-0 items-center gap-2.5 text-white">
                  <IconDices size={15} className="shrink-0 text-white/90" aria-hidden />
                  Casino
                </span>
                <IconChevronDown
                  size={15}
                  className={`shrink-0 text-white/90 transition ${casinoOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
            )}

            {!collapsed && casinoOpen ? (
              <div className="mb-2 ml-2 mt-1 flex flex-col gap-0.5 border-l border-casino-primary/22 pl-3">
                {casinoItems.map(renderSubItem)}
              </div>
            ) : null}
          </div>

          {extraItems.filter((x) => x.id !== 'sports').map(renderTopItem)}

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
