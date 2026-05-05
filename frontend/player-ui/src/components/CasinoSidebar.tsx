import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'
import { RequireAuthNavLink } from './RequireAuthNavLink'
import { useSiteContent } from '../hooks/useSiteContent'
import {
  CASINO_NAV_FALLBACK_CATEGORIES,
  CASINO_NAV_FALLBACK_EXTRAS,
  CASINO_NAV_FALLBACK_PROMO,
  CASINO_NAV_ROUTE_MAP,
  type CasinoNavCategory,
} from '../lib/casinoNav'
import { translateNavItemLabel } from '../lib/navI18n'
import CasinoNavCasinoLinks from './CasinoNavCasinoLinks'
import HeaderCasinoSportsSegment from './HeaderCasinoSportsSegment'
import { LanguageMenu } from './LanguageMenu'
import { sportsbookPlayerPath } from '../lib/oddin/oddin.config'
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
  IconHeadphones,
  IconMessageSquare,
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
  collapsed: boolean
  onToggleCollapse: () => void
  /** Below-lg header hides chat; sidebar footer exposes it on phones/tablets only. */
  onOpenChat?: () => void
  chatOpen?: boolean
  chatUnreadCount?: number
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

const ROUTE_MAP = CASINO_NAV_ROUTE_MAP

export default function CasinoSidebar({
  collapsed,
  onToggleCollapse,
  onOpenChat,
  chatOpen = false,
  chatUnreadCount = 0,
}: CasinoSidebarProps) {
  const [casinoOpen, setCasinoOpen] = useState(true)
  const { pathname, hash } = useLocation()
  const { t } = useTranslation()
  const { getContent } = useSiteContent()

  const casinoItems = getContent<CasinoNavCategory[]>('nav.categories.casino', CASINO_NAV_FALLBACK_CATEGORIES)
    .filter((c) => c.enabled !== false)
  const extraItems = getContent<CasinoNavCategory[]>('nav.categories.extras', CASINO_NAV_FALLBACK_EXTRAS)
    .filter((c) => c.enabled !== false)
  const promoItems = getContent<CasinoNavCategory[]>('nav.categories.promo', CASINO_NAV_FALLBACK_PROMO)
    .filter((c) => c.enabled !== false)

  const onGamesCatalog = pathname === '/casino/games'
  const hotNowSidebarActive = onGamesCatalog && hash === ''
  const helpSidebarActive = onGamesCatalog && hash === '#help'
  const blogSidebarActive = onGamesCatalog && hash === '#blog'
  const raffleSidebarActive = onGamesCatalog && hash === '#raffle'

  /** Desktop sidebar only — mobile uses `MobileCasinoMenuOverlay`. */
  const closeIfMobile = () => {}

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

  const icon = (id: string, size: number) => (ICON_MAP[id] ?? (() => null))(size)

  const renderTopItem = (section: 'promo' | 'extras') => (item: CasinoNavCategory) => {
    const label = translateNavItemLabel(t, section, item)
    const route =
      item.id === 'sports' ? sportsbookPlayerPath() : (ROUTE_MAP[item.id] ?? '')
    /** Sports stays browsable when logged out; VIP/rewards-style promo routes require sign-in. */
    const publicPromo = item.id === 'sports'

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
            title={label}
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
          {label}
        </NavLink>
      )
    }

    if (!route || item.coming_soon) {
      if (collapsed) {
        return (
          <span key={item.id} className={navItem} title={`${label}${item.coming_soon ? ` (${t('sidebar.comingSoon')})` : ''}`}>
            {icon(item.id, 15)}
          </span>
        )
      }
      return (
        <span key={item.id} className={`${navItem} cursor-default opacity-45`} title={item.coming_soon ? t('sidebar.comingSoon') : undefined}>
          <span className="flex items-center gap-2.5">
            {icon(item.id, 15)}
            {label}
          </span>
        </span>
      )
    }

    if (collapsed) {
      if (publicPromo) {
        return (
          <NavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`} title={label}>
            {icon(item.id, 15)}
          </NavLink>
        )
      }
      return (
        <RequireAuthNavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`} title={label}>
          {icon(item.id, 15)}
        </RequireAuthNavLink>
      )
    }

    if (publicPromo) {
      return (
        <NavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`}>
          <span className="flex items-center gap-2.5">
            {icon(item.id, 15)}
            {label}
          </span>
        </NavLink>
      )
    }

    return (
      <RequireAuthNavLink key={item.id} to={route} className={({ isActive }) => `${navItem} ${isActive ? navItemActive : ''}`}>
        <span className="flex items-center gap-2.5">
          {icon(item.id, 15)}
          {label}
        </span>
      </RequireAuthNavLink>
    )
  }

  return (
    <aside
      className={`flex h-full min-h-0 min-w-0 shrink-0 flex-col border-r border-white/[0.06] bg-casino-sidebar shadow-[4px_0_32px_rgba(0,0,0,0.45)] transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[52px]' : 'w-[200px]'
      }`}
    >
        <div className="shrink-0 border-b border-white/[0.06] bg-casino-sidebar px-0.5 pt-2 pb-2">
          <div className="block">
            {collapsed ? (
              <div className="flex h-14 items-center justify-center px-2">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover"
                  onClick={onToggleCollapse}
                  aria-label={t('sidebar.expandSidebar')}
                  title={t('sidebar.expandSidebar')}
                >
                  <IconPanelLeftOpen size={18} aria-hidden />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover"
                  onClick={onToggleCollapse}
                  aria-label={t('sidebar.collapseSidebar')}
                  title={t('sidebar.collapseSidebar')}
                >
                  <IconPanelLeftClose size={18} aria-hidden />
                </button>
                <HeaderCasinoSportsSegment className="min-w-0 flex-1" onNavigate={closeIfMobile} />
              </div>
            )}
          </div>
        </div>

        <nav
          className={`scrollbar-none flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-y-contain pb-10 pt-4 ${
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
                title={t('sidebar.casino')}
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
                  {t('sidebar.casino')}
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
                <CasinoNavCasinoLinks items={casinoItems} variant="sidebar" iconSize={15} />
              </div>
            ) : null}
          </div>

          {extraItems.filter((x) => x.id !== 'sports').map(renderTopItem('extras'))}

          <div className={`my-2.5 h-px bg-casino-border ${collapsed ? 'w-full' : ''}`} role="separator" />

          {collapsed ? (
            <>
              {promoItems.map(renderTopItem('promo'))}

              <div className="my-2.5 h-px w-full bg-casino-border" role="separator" />

              <LanguageMenu variant="collapsed" buttonClassName={navItem} />
              {onOpenChat ? (
                <button
                  type="button"
                  className={`${navItem} relative ${chatOpen ? navItemActive : ''}`}
                  title={t('sidebar.chat')}
                  aria-label={t('sidebar.chat')}
                  onClick={onOpenChat}
                >
                  <IconMessageSquare size={15} aria-hidden />
                  {chatUnreadCount > 0 && !chatOpen ? (
                    <span className="absolute right-1.5 top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-casino-segment px-0.5 text-[8px] font-bold text-casino-bg ring-1 ring-casino-sidebar">
                      {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
              <NavLink
                to="/casino/games#help"
                className={`${navItem} ${helpSidebarActive ? navItemActive : ''}`}
                title={t('sidebar.liveSupport')}
              >
                <IconHeadphones size={15} aria-hidden />
              </NavLink>
              <NavLink
                to="/casino/games#blog"
                className={`${navItem} ${blogSidebarActive ? navItemActive : ''}`}
                title={t('sidebar.blog')}
              >
                <IconFileText size={15} aria-hidden />
              </NavLink>
            </>
          ) : (
            <>
              {promoItems.map(renderTopItem('promo'))}

              <div className="my-2.5 h-px bg-casino-border" role="separator" />

              <LanguageMenu variant="expanded" buttonClassName={navItem} />
              {onOpenChat ? (
                <button
                  type="button"
                  className={`${navItem} relative ${chatOpen ? navItemActive : ''}`}
                  aria-label={t('sidebar.chat')}
                  aria-pressed={chatOpen}
                  onClick={onOpenChat}
                >
                  <span className="flex items-center gap-2.5">
                    <IconMessageSquare size={15} aria-hidden />
                    {t('sidebar.chat')}
                  </span>
                  {chatUnreadCount > 0 && !chatOpen ? (
                    <span className="rounded-full bg-casino-segment px-1.5 py-0.5 text-[10px] font-bold text-casino-bg">
                      {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
              <NavLink
                to="/casino/games#help"
                className={`${navItem} ${helpSidebarActive ? navItemActive : ''}`}
              >
                <span className="flex items-center gap-2.5">
                  <IconHeadphones size={15} aria-hidden />
                  {t('sidebar.liveSupport')}
                </span>
              </NavLink>
              <NavLink
                to="/casino/games#blog"
                className={`${navItem} ${blogSidebarActive ? navItemActive : ''}`}
              >
                <span className="flex items-center gap-2.5">
                  <IconFileText size={15} aria-hidden />
                  {t('sidebar.blog')}
                </span>
              </NavLink>
            </>
          )}
        </nav>
      </aside>
  )
}
