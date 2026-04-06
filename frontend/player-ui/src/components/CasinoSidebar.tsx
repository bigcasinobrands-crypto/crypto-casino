import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { RequireAuthNavLink } from './RequireAuthNavLink'
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

export default function CasinoSidebar({ mobileOpen, onClose, collapsed, onToggleCollapse }: CasinoSidebarProps) {
  const [casinoOpen, setCasinoOpen] = useState(true)
  const { pathname, hash } = useLocation()

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
                <NavLink
                  to="/casino/games"
                  end
                  className={`${subLink} ${hotNowSidebarActive ? subActive : ''}`}
                >
                  <IconSwords size={15} aria-hidden />
                  Hot now
                </NavLink>
                <RequireAuthNavLink to="/casino/new" className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}>
                  <IconSparkles size={15} aria-hidden />
                  New Releases
                </RequireAuthNavLink>
                <RequireAuthNavLink to="/casino/slots" className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}>
                  <IconGem size={15} aria-hidden />
                  Slots
                </RequireAuthNavLink>
                <RequireAuthNavLink
                  to="/casino/bonus-buys"
                  className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}
                >
                  <IconBanknote size={15} aria-hidden />
                  Bonus Buys
                </RequireAuthNavLink>
                <RequireAuthNavLink to="/casino/live" className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}>
                  <IconRadio size={15} aria-hidden />
                  Live
                </RequireAuthNavLink>
                <RequireAuthNavLink
                  to="/casino/challenges"
                  className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}
                >
                  <IconTarget size={15} aria-hidden />
                  Challenges
                </RequireAuthNavLink>
                <RequireAuthNavLink
                  to="/casino/favourites"
                  className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}
                >
                  <IconStar size={15} aria-hidden />
                  Favourites
                </RequireAuthNavLink>
                <RequireAuthNavLink to="/casino/recent" className={({ isActive }) => `${subLink} ${isActive ? subActive : ''}`}>
                  <IconClock size={15} aria-hidden />
                  Recently Played
                </RequireAuthNavLink>
                <RequireAuthNavLink
                  to="/casino/games#providers"
                  className={`${subLink} ${providersSidebarActive ? subActive : ''}`}
                >
                  <IconBuilding2 size={15} aria-hidden />
                  Providers
                </RequireAuthNavLink>
              </div>
            ) : null}
          </div>

          {collapsed ? (
            <span className={navItem} title="Sports (coming soon)">
              <IconTrophy size={15} aria-hidden />
            </span>
          ) : (
            <span className={`${navItem} cursor-default opacity-45`} title="Coming soon">
              <span className="flex items-center gap-2.5">
                <IconTrophy size={15} aria-hidden />
                Sports
              </span>
            </span>
          )}

          <div className={`my-2.5 h-px bg-casino-border ${collapsed ? 'w-full' : ''}`} role="separator" />

          {collapsed ? (
            <>
              <RequireAuthNavLink to="/casino/featured" className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`} title="Rewards">
                <IconGift size={15} aria-hidden />
              </RequireAuthNavLink>
              <span className={navItem} title="Affiliate">
                <IconUsers size={15} aria-hidden />
              </span>
              <RequireAuthNavLink to="/profile" className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`} title="VIP">
                <IconCrown size={15} aria-hidden />
              </RequireAuthNavLink>
              <span className={navItem} title="Farming">
                <IconTractor size={15} aria-hidden />
              </span>
              <RequireAuthNavLink to="/casino/games" className={navItem} title="$25K Raffle">
                <IconTicket size={15} aria-hidden />
              </RequireAuthNavLink>

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
              <RequireAuthNavLink to="/casino/featured" className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`}>
                <span className="flex items-center gap-2.5">
                  <IconGift size={15} aria-hidden />
                  Rewards
                </span>
              </RequireAuthNavLink>
              <span className={`${navItem} cursor-default opacity-45`} title="Demo">
                <span className="flex items-center gap-2.5">
                  <IconUsers size={15} aria-hidden />
                  Affiliate
                </span>
              </span>
              <RequireAuthNavLink to="/profile" className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`}>
                <span className="flex items-center gap-2.5">
                  <IconCrown size={15} aria-hidden />
                  VIP
                </span>
              </RequireAuthNavLink>
              <span className={`${navItem} cursor-default opacity-45`}>
                <span className="flex items-center gap-2.5">
                  <IconTractor size={15} aria-hidden />
                  Farming
                </span>
              </span>
              <RequireAuthNavLink to="/casino/games" className={navItem}>
                <span className="flex items-center gap-2.5">
                  <IconTicket size={15} aria-hidden />
                  $25K Raffle
                </span>
              </RequireAuthNavLink>

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
