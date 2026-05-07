import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuthModal } from '../authModalContext'
import { usePlayerAuth } from '../playerAuth'
import {
  IconBanknote,
  IconDices,
  IconGift,
  IconMenu,
  IconSearch,
} from './icons'
import { isEsportsPlayerRoute } from '../lib/oddin/oddin.config'

type PlayerMobileBottomNavProps = {
  /** Sidebar drawer open — highlights Menu tab (no route). */
  menuOpen?: boolean
  /** Game search overlay open — highlights Search tab. */
  gameSearchOpen?: boolean
  /** Wallet modal open on Deposit tab (bottom nav opens modal, not always `/wallet/deposit`). */
  depositFlowActive?: boolean
  /** Menu, search, wallet modal, chat, header dropdowns — call before route/auth-only actions. */
  onDismissAllChrome?: () => void
  onOpenMenu: () => void
  onOpenGameSearch: () => void
  onOpenDeposit: () => void
  showCasinoSearch: boolean
  /**
   * Extra classes on the fixed nav (e.g. `casino-shell-mobile-nav--esports-tablet` to force visibility
   * between 768–1279px where the bar is normally hidden).
   */
  navClassName?: string
}

/** Labels always visible; active = purple icon + brighter label (vybebet-style). */
const tabShell = (active: boolean) =>
  [
    'casino-mnav-item flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-[10px] font-semibold leading-tight transition duration-200 no-underline [-webkit-tap-highlight-color:transparent] outline-none focus-visible:ring-2 focus-visible:ring-casino-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0d14]',
    active ? 'casino-mnav-item--active' : '',
  ].join(' ')

const iconActive = 'shrink-0 text-casino-primary'
const iconInactive = 'shrink-0 text-slate-400'

/** Fixed 60px bar — visibility controlled by `.casino-shell-mobile-nav` in `casino-shell.css` (&lt;768px only). */
export default function PlayerMobileBottomNav({
  menuOpen = false,
  gameSearchOpen = false,
  depositFlowActive = false,
  onDismissAllChrome,
  onOpenMenu,
  onOpenGameSearch,
  onOpenDeposit,
  showCasinoSearch,
  navClassName = '',
}: PlayerMobileBottomNavProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  const casinoActive = pathname.startsWith('/casino/') && !isEsportsPlayerRoute(pathname)

  const bonusesActive = pathname.startsWith('/bonuses')

  const depositActive = pathname.startsWith('/wallet/deposit')

  /** When search overlay or menu is open, suppress route-based tab chrome except Search / Menu. */
  const routeHighlight = !menuOpen && !gameSearchOpen
  const menuHighlighted = menuOpen
  const searchHighlighted = gameSearchOpen && !menuOpen
  const depositHighlighted =
    !menuOpen && !gameSearchOpen && (depositActive || depositFlowActive)
  const bonusesHighlighted = routeHighlight && bonusesActive
  const casinoHighlighted = routeHighlight && casinoActive

  const handleDeposit = () => {
    if (!isAuthenticated) {
      onDismissAllChrome?.()
      openAuth('login', { walletTab: 'deposit' })
      return
    }
    onOpenDeposit()
  }

  const handleBonuses = () => {
    onDismissAllChrome?.()
    if (!isAuthenticated) {
      openAuth('login', { navigateTo: '/bonuses' })
      return
    }
    navigate('/bonuses')
  }

  const handleSearch = () => {
    if (showCasinoSearch) {
      onOpenGameSearch()
      return
    }
    onDismissAllChrome?.()
    navigate('/casino/games?gamesearch=1')
  }

  const labelClass = (active: boolean) =>
    `casino-mnav-label max-w-[4.5rem] truncate text-center ${active ? 'font-bold text-white' : 'font-medium text-slate-500'}`

  const nav = (
    <nav
      className={`casino-shell-mobile-nav pointer-events-auto fixed inset-x-0 bottom-0 z-[205] box-border flex min-h-[56px] flex-col justify-center border-t border-white/[0.08] bg-[#0f0d14] py-1 pb-[max(6px,env(safe-area-inset-bottom,0px))] pt-1.5 shadow-[0_-6px_24px_rgba(0,0,0,0.45)] ${navClassName}`.trim()}
      aria-label={t('mobileNav.ariaMain')}
    >
      <div className="mx-auto flex min-h-[44px] w-full max-w-full min-w-0 items-end justify-between gap-0 px-0.5">
        <button
          type="button"
          className={tabShell(menuHighlighted)}
          onClick={onOpenMenu}
          aria-current={menuHighlighted ? 'page' : undefined}
        >
          <IconMenu size={20} className={menuHighlighted ? iconActive : iconInactive} aria-hidden />
          <span className={labelClass(menuHighlighted)}>{t('mobileNav.menu')}</span>
        </button>

        <button
          type="button"
          className={tabShell(searchHighlighted)}
          onClick={handleSearch}
          aria-current={searchHighlighted ? 'page' : undefined}
        >
          <IconSearch size={20} className={searchHighlighted ? iconActive : iconInactive} aria-hidden />
          <span className={labelClass(searchHighlighted)}>{t('mobileNav.search')}</span>
        </button>

        <button
          type="button"
          className={tabShell(depositHighlighted)}
          onClick={handleDeposit}
          aria-current={depositHighlighted ? 'page' : undefined}
        >
          <IconBanknote size={22} className={depositHighlighted ? iconActive : iconInactive} aria-hidden />
          <span className={labelClass(depositHighlighted)}>{t('mobileNav.deposit')}</span>
        </button>

        <button
          type="button"
          className={tabShell(bonusesHighlighted)}
          onClick={handleBonuses}
          aria-current={bonusesHighlighted ? 'page' : undefined}
        >
          <IconGift size={20} className={bonusesHighlighted ? iconActive : iconInactive} aria-hidden />
          <span className={labelClass(bonusesHighlighted)}>{t('mobileNav.bonuses')}</span>
        </button>

        <NavLink
          to="/casino/games"
          onClick={() => onDismissAllChrome?.()}
          className={() => tabShell(casinoHighlighted)}
          aria-current={casinoHighlighted ? 'page' : undefined}
        >
          <IconDices size={20} className={casinoHighlighted ? iconActive : iconInactive} aria-hidden />
          <span className={labelClass(casinoHighlighted)}>{t('mobileNav.casino')}</span>
        </NavLink>
      </div>
    </nav>
  )

  if (typeof document === 'undefined') return null

  return createPortal(nav, document.body)
}
