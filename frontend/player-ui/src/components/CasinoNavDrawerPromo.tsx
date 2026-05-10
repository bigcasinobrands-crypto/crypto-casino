import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'
import { RequireAuthNavLink } from './RequireAuthNavLink'
import type { CasinoNavCategory } from '../lib/casinoNav'
import { casinoNavRoute } from '../lib/casinoNav'
import { translateNavItemLabel } from '../lib/navI18n'
import { PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT, PLAYER_CHROME_OPEN_AFFILIATE_MODAL_EVENT } from '../lib/playerChromeEvents'
import { IconCrown, IconGift, IconTicket, IconUsers } from './icons'

const PROMO_ICONS: Record<string, (size: number) => ReactNode> = {
  rewards: (s) => <IconGift size={s} aria-hidden />,
  affiliate: (s) => <IconUsers size={s} aria-hidden />,
  vip: (s) => <IconCrown size={s} aria-hidden />,
  raffle: (s) => <IconTicket size={s} aria-hidden />,
}

const row =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground [&_svg]:shrink-0 [&_svg]:text-casino-primary'
const rowActive = 'bg-casino-primary/22 text-white hover:bg-casino-primary/28 [&_svg]:text-casino-primary'

type Props = {
  promoItems: CasinoNavCategory[]
}

/**
 * Promo / account rows in the mobile drawer — routes mirror desktop sidebar (`CasinoSidebar` `renderTopItem`).
 */
export default function CasinoNavDrawerPromo({ promoItems }: Props) {
  const { t } = useTranslation()
  const { pathname, hash } = useLocation()
  const raffleActive = pathname === '/casino/games' && hash === '#raffle'

  return (
    <>
      {promoItems.map((item) => {
        const route = casinoNavRoute(item.id)
        const label = translateNavItemLabel(t, 'promo', item)
        const ico = (PROMO_ICONS[item.id] ?? ((s: number) => <IconGift size={s} aria-hidden />))(17)

        if (item.id === 'affiliate') {
          return (
            <button
              key={item.id}
              type="button"
              className={row}
              onClick={(e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT))
                window.dispatchEvent(new CustomEvent(PLAYER_CHROME_OPEN_AFFILIATE_MODAL_EVENT))
              }}
            >
              {ico}
              {label}
            </button>
          )
        }

        if (item.id === 'raffle' && route && !item.coming_soon) {
          return (
            <NavLink
              key={item.id}
              to={route}
              className={`mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-casino-surface px-3 py-2.5 text-[13px] font-bold text-casino-foreground transition hover:bg-casino-chip-hover [&_svg]:text-casino-primary ${
                raffleActive ? 'border-casino-primary/40 bg-casino-primary/15' : ''
              }`}
            >
              {ico}
              {label}
            </NavLink>
          )
        }

        if (!route || item.coming_soon) {
          return (
            <span key={item.id} className={`${row} cursor-default opacity-45`} title={item.coming_soon ? t('sidebar.comingSoon') : undefined}>
              {ico}
              {label}
            </span>
          )
        }

        return (
          <RequireAuthNavLink key={item.id} to={route} className={({ isActive }) => `${row} ${isActive ? rowActive : ''}`}>
            {ico}
            {label}
          </RequireAuthNavLink>
        )
      })}
    </>
  )
}
