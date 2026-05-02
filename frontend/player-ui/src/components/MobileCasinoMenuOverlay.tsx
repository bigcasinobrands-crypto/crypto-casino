/**
 * Left drawer menu (<1280px). Same nav targets as desktop `CasinoSidebar` — driven by `lib/casinoNav` + CMS.
 */
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import HeaderCasinoSportsSegment from './HeaderCasinoSportsSegment'
import {
  CASINO_NAV_FALLBACK_CATEGORIES,
  CASINO_NAV_FALLBACK_EXTRAS,
  CASINO_NAV_FALLBACK_PROMO,
  casinoNavRoute,
  type CasinoNavCategory,
} from '../lib/casinoNav'
import { useSiteContent } from '../hooks/useSiteContent'
import CasinoNavCasinoLinks from './CasinoNavCasinoLinks'
import CasinoNavDrawerPromo from './CasinoNavDrawerPromo'
import {
  IconChevronDown,
  IconDices,
  IconFileText,
  IconGlobe,
  IconHeadphones,
  IconTrophy,
  IconX,
} from './icons'

type Props = {
  open: boolean
  onClose: () => void
}

const row =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground [&_svg]:shrink-0 [&_svg]:text-casino-primary'

const casinoHeaderBtn =
  'flex w-full items-center justify-between rounded-2xl bg-casino-primary px-3.5 py-3 text-left text-[13px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'

export default function MobileCasinoMenuOverlay({ open, onClose }: Props) {
  const [casinoOpen, setCasinoOpen] = useState(true)
  const { getContent } = useSiteContent()

  const casinoItems = getContent<CasinoNavCategory[]>('nav.categories.casino', CASINO_NAV_FALLBACK_CATEGORIES).filter(
    (c) => c.enabled !== false,
  )
  const extraItems = getContent<CasinoNavCategory[]>('nav.categories.extras', CASINO_NAV_FALLBACK_EXTRAS).filter(
    (c) => c.enabled !== false,
  )
  const promoItems = getContent<CasinoNavCategory[]>('nav.categories.promo', CASINO_NAV_FALLBACK_PROMO).filter(
    (c) => c.enabled !== false,
  )

  if (!open) return null

  return (
    <div
      className="mobile-menu-overlay-root fixed inset-0 z-[260] flex min-[1280px]:hidden"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label="Close menu"
        onClick={onClose}
      />
      <aside
        className="relative z-10 flex h-full w-[min(82vw,320px)] max-w-[320px] flex-col border-r border-white/[0.06] bg-casino-sidebar shadow-[4px_0_32px_rgba(0,0,0,0.5)]"
        role="dialog"
        aria-modal="true"
        aria-label="Casino menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 pb-2 pt-[max(10px,env(safe-area-inset-top))]">
          <HeaderCasinoSportsSegment className="min-w-0 flex-1" onNavigate={onClose} />
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-casino-chip text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06]"
            onClick={onClose}
            aria-label="Close menu"
          >
            <IconX size={20} aria-hidden />
          </button>
        </div>

        <nav
          className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-10 pt-3"
          onClick={() => onClose()}
        >
          <button
            type="button"
            className={casinoHeaderBtn}
            aria-expanded={casinoOpen}
            onClick={(e) => {
              e.stopPropagation()
              setCasinoOpen((o) => !o)
            }}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <IconDices size={15} className="shrink-0 text-white/90" aria-hidden />
              Casino
            </span>
            <IconChevronDown
              size={15}
              className={`shrink-0 text-white/90 transition ${casinoOpen ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>

          {casinoOpen ? (
            <div className="mb-1 ml-2 mt-1 flex flex-col gap-0.5 border-l border-casino-primary/22 pl-3">
              <CasinoNavCasinoLinks items={casinoItems} variant="drawer" iconSize={17} />
            </div>
          ) : null}

          <div className="my-2 h-px bg-casino-border" role="separator" />

          <CasinoNavDrawerPromo promoItems={promoItems} />

          <div className="my-2 h-px bg-casino-border" role="separator" />

          {extraItems
            .filter((x) => x.id === 'sports')
            .map((item) => {
              const to = casinoNavRoute(item.id)
              if (!to) return null
              return (
                <NavLink
                  key={item.id}
                  to={to}
                  className={({ isActive }) =>
                    `${row} ${isActive ? 'bg-casino-primary/22 text-white hover:bg-casino-primary/28 [&_svg]:text-casino-primary' : ''}`
                  }
                >
                  <IconTrophy size={17} aria-hidden />
                  {item.label}
                </NavLink>
              )
            })}

          <div className="my-2 h-px bg-casino-border" role="separator" />

          <button type="button" className={`${row} cursor-default`}>
            <IconGlobe size={17} aria-hidden />
            Language
            <IconChevronDown size={15} className="ml-auto opacity-70" aria-hidden />
          </button>
          <NavLink to="/casino/games#help" className={row}>
            <IconHeadphones size={17} aria-hidden />
            Live Support
          </NavLink>
          <NavLink to="/casino/games#blog" className={row}>
            <IconFileText size={17} aria-hidden />
            Blog
          </NavLink>
        </nav>
      </aside>
    </div>
  )
}
