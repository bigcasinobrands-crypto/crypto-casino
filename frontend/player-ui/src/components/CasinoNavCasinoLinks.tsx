import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { RequireAuthNavLink } from './RequireAuthNavLink'
import {
  IconBuilding2,
  IconClock,
  IconGem,
  IconBanknote,
  IconRadio,
  IconSparkles,
  IconStar,
  IconSwords,
  IconTarget,
} from './icons'
import type { CasinoNavCategory } from '../lib/casinoNav'
import {
  casinoNavRoute,
  casinoNavSubLinkUsesAuth,
  isCasinoNavHotNow,
  isCasinoNavProviders,
} from '../lib/casinoNav'

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
}

function iconEl(id: string, size: number) {
  return (ICON_MAP[id] ?? (() => null))(size)
}

type Variant = 'sidebar' | 'drawer'

const variantClasses = {
  sidebar: {
    link: 'flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-2.5 pr-2 text-left text-[12px] font-medium text-casino-muted transition hover:bg-white/[0.04] hover:text-casino-foreground [&_svg]:shrink-0 [&_svg]:text-casino-primary/88',
    active:
      'bg-casino-primary/22 font-semibold text-white hover:bg-casino-primary/28 [&_svg]:text-casino-primary',
    disabled: 'flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-2.5 pr-2 text-left text-[12px] font-medium text-casino-muted cursor-default opacity-45',
  },
  drawer: {
    link: 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground [&_svg]:shrink-0 [&_svg]:text-casino-primary',
    active: 'bg-casino-primary/22 text-white hover:bg-casino-primary/28 [&_svg]:text-casino-primary',
    disabled: 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold text-casino-muted cursor-default opacity-45',
  },
} as const

type Props = {
  items: CasinoNavCategory[]
  variant: Variant
  iconSize: number
}

/**
 * Casino catalog subsection — shared by desktop sidebar and mobile (`<768px`) drawer so URLs and labels stay aligned.
 */
export default function CasinoNavCasinoLinks({ items, variant, iconSize }: Props) {
  const { pathname, hash } = useLocation()
  const vc = variantClasses[variant]

  const hotNowActive = pathname === '/casino/games' && hash === ''
  const providersActive =
    pathname === '/casino/games' && (hash === '#studios' || hash === '#providers')

  return (
    <>
      {items.map((item) => {
        const route = casinoNavRoute(item.id)
        const key = item.id

        if (!route || item.coming_soon) {
          return (
            <span key={key} className={vc.disabled} title={item.coming_soon ? 'Coming soon' : undefined}>
              {iconEl(item.id, iconSize)}
              {item.label}
            </span>
          )
        }

        if (isCasinoNavHotNow(item.id)) {
          return (
            <NavLink
              key={key}
              to={route}
              end
              className={`${vc.link} ${hotNowActive ? vc.active : ''}`}
            >
              {iconEl(item.id, iconSize)}
              {item.label}
            </NavLink>
          )
        }

        if (isCasinoNavProviders(item.id)) {
          return (
            <NavLink key={key} to={route} className={`${vc.link} ${providersActive ? vc.active : ''}`}>
              {iconEl(item.id, iconSize)}
              {item.label}
            </NavLink>
          )
        }

        if (casinoNavSubLinkUsesAuth(item.id)) {
          return (
            <RequireAuthNavLink
              key={key}
              to={route}
              className={({ isActive }) => `${vc.link} ${isActive ? vc.active : ''}`}
            >
              {iconEl(item.id, iconSize)}
              {item.label}
            </RequireAuthNavLink>
          )
        }

        return (
          <NavLink key={key} to={route} className={({ isActive }) => `${vc.link} ${isActive ? vc.active : ''}`}>
            {iconEl(item.id, iconSize)}
            {item.label}
          </NavLink>
        )
      })}
    </>
  )
}
