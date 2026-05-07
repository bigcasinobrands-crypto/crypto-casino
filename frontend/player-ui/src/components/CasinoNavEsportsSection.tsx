import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useOddinEsportsNav } from '../hooks/useOddinEsportsNav'
import { translateEsportsNavLabel } from '../lib/navI18n'
import type { EsportsNavItem } from '../lib/oddin/esportsNavCatalog'
import { useOddinBootstrap } from '../context/OddinBootstrapContext'
import { sportsbookPlayerPath } from '../lib/oddin/oddin.config'
import { IconChevronDown, IconSwords, IconTrophy } from './icons'

type Variant = 'sidebar' | 'drawer'

function esportsHref(item: EsportsNavItem): string {
  const base = sportsbookPlayerPath()
  if (!item.page) return base
  return `${base}?page=${encodeURIComponent(item.page)}`
}

function isEsportsSubActive(search: string, item: EsportsNavItem): boolean {
  const q = new URLSearchParams(search)
  const cur = q.get('page')?.trim() ?? ''
  if (!item.page) return cur === ''
  return cur === item.page.trim()
}

/** ~One column: same height as Casino line icons (15px); narrow width so rows stay compact. */
const iconCell =
  'flex h-[15px] w-9 shrink-0 items-center justify-start overflow-hidden'

function EsportsRowGlyph({ item, size }: { item: EsportsNavItem; size: number }) {
  const [imgOk, setImgOk] = useState(true)
  if (item.id === 'overview') {
    return <IconTrophy size={size} className="shrink-0 text-casino-primary/88" aria-hidden />
  }
  if (!item.logoUrl) {
    return <IconSwords size={size} className="shrink-0 text-casino-primary/88" aria-hidden />
  }
  if (!imgOk) {
    return <IconSwords size={size} className="shrink-0 text-casino-primary/88" aria-hidden />
  }
  return (
    <img
      src={item.logoUrl}
      alt=""
      className="h-[15px] w-auto max-w-[2.25rem] shrink-0 object-contain object-left opacity-90"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setImgOk(false)}
    />
  )
}

/** Same rhythm as CasinoNavCasinoLinks (sidebar + drawer). */
const sidebarSub =
  'flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-2.5 pr-2 text-left text-[12px] font-medium leading-snug text-casino-muted transition hover:bg-white/[0.04] hover:text-casino-foreground [&_svg]:shrink-0 [&_svg]:text-casino-primary/88'
const sidebarSubActive =
  'bg-casino-primary/22 font-semibold text-white hover:bg-casino-primary/28 [&_svg]:text-casino-primary'

const drawerSub =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold leading-snug text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground [&_svg]:shrink-0 [&_svg]:text-casino-primary'
const drawerSubActive = 'bg-casino-primary/22 text-white hover:bg-casino-primary/28 [&_svg]:text-casino-primary'

type Props = {
  variant: Variant
  collapsed: boolean
  onNavigate?: () => void
}

/**
 * E-Sports accordion (Bifrost `?page=` routes). Logos: Oddin / operator via GET /v1/sportsbook/oddin/esports-nav (ODDIN_ESPORTS_NAV_JSON).
 */
export default function CasinoNavEsportsSection({ variant, collapsed, onNavigate }: Props) {
  const { t } = useTranslation()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { esportsIntegrationActive } = useOddinBootstrap()
  const { items, labelsFromOperator } = useOddinEsportsNav()
  const segmentActive = pathname.startsWith('/casino/sports')
  const [open, setOpen] = useState(() => segmentActive)

  /** Top header toggle switches shell (Casino vs E-Sports) — keep accordions in sync with the route. */
  useEffect(() => {
    if (segmentActive) setOpen(true)
    else setOpen(false)
  }, [segmentActive])

  const showAccordion = esportsIntegrationActive
  const sportsLabel = t('nav.extras.sports')

  const navItemCollapsed =
    'flex w-full items-center justify-center rounded-lg p-2.5 text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground [&_svg]:text-casino-primary/88'
  const navItemCollapsedActive = 'bg-casino-primary/22 text-white hover:bg-casino-primary/30 [&_svg]:text-casino-primary'

  const navItemExpanded =
    'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground [&_svg]:text-casino-primary/88'
  const navItemExpandedActive = 'bg-casino-primary/22 text-white hover:bg-casino-primary/30 [&_svg]:text-casino-primary'

  const rowLabel = (item: EsportsNavItem) => (labelsFromOperator ? item.label : translateEsportsNavLabel(t, item))

  if (collapsed) {
    return (
      <NavLink
        to={sportsbookPlayerPath()}
        className={({ isActive }) => `${navItemCollapsed} ${isActive ? navItemCollapsedActive : ''}`}
        title={sportsLabel}
      >
        <IconTrophy size={15} aria-hidden />
      </NavLink>
    )
  }

  if (!showAccordion) {
    return (
      <NavLink
        to={sportsbookPlayerPath()}
        className={({ isActive }) => `${navItemExpanded} ${isActive ? navItemExpandedActive : ''}`}
        onClick={onNavigate}
      >
        <span className="flex items-center gap-2.5">
          <IconTrophy size={15} aria-hidden />
          {sportsLabel}
        </span>
      </NavLink>
    )
  }

  const sectionHeaderBtn =
    'flex w-full items-center justify-between rounded-2xl px-3.5 py-3 text-left text-[13px] font-bold transition'
  const sectionOpen =
    'bg-casino-primary text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:brightness-110'
  const sectionClosed = 'bg-casino-primary-dim text-white hover:bg-casino-primary'
  /** Inactive shell segment (browsing Casino) — gray track; tap jumps to E-Sports. */
  const sectionInactiveShell =
    'border border-white/[0.08] bg-casino-segment-track text-casino-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.06] hover:text-white/90'

  const subWrap =
    variant === 'sidebar' ? 'mb-2 ml-2 mt-1 border-l border-casino-primary/22 pl-3' : 'mb-1'

  const subListScroll =
    variant === 'sidebar'
      ? 'scrollbar-esports flex min-h-0 max-h-[min(24rem,55dvh)] flex-col gap-0.5 overflow-y-auto overscroll-y-contain py-0.5 pr-0.5'
      : 'scrollbar-esports flex min-h-0 max-h-[min(32rem,70dvh)] flex-col gap-0.5 overflow-y-auto overscroll-y-contain py-0.5 pr-0.5'

  const headerChevronClass = segmentActive
    ? `shrink-0 transition ${open ? 'rotate-180 text-white/90' : 'text-white/90'}`
    : 'icon-chevron shrink-0 text-casino-muted/90 transition'

  return (
    <div>
      <button
        type="button"
        className={`${sectionHeaderBtn} ${segmentActive ? (open ? sectionOpen : sectionClosed) : sectionInactiveShell}`}
        onClick={(e) => {
          e.stopPropagation()
          if (!segmentActive) {
            navigate(sportsbookPlayerPath())
            onNavigate?.()
            return
          }
          setOpen((o) => !o)
        }}
        aria-expanded={segmentActive ? open : false}
      >
        <span
          className={`flex min-w-0 items-center gap-2.5 ${segmentActive ? 'text-white' : 'text-inherit'}`}
        >
          <IconTrophy
            size={15}
            className={`shrink-0 ${segmentActive ? 'text-white/90' : 'text-casino-muted'}`}
            aria-hidden
          />
          {sportsLabel}
        </span>
        <IconChevronDown size={15} className={headerChevronClass} aria-hidden />
      </button>

      {open ? (
        <div className={subWrap}>
          <div
            className={subListScroll}
            role="group"
            aria-label={sportsLabel}
            onClick={(e) => e.stopPropagation()}
          >
          {items.map((item) => {
            const to = esportsHref(item)
            const active = pathname === '/casino/sports' && isEsportsSubActive(search, item)
            const label = rowLabel(item)
            const iconSize = 15
            if (variant === 'drawer') {
              return (
                <NavLink
                  key={item.id}
                  to={to}
                  className={`${drawerSub} ${active ? drawerSubActive : ''}`}
                  onClick={onNavigate}
                >
                  <span className={iconCell} aria-hidden>
                    <EsportsRowGlyph item={item} size={iconSize} />
                  </span>
                  <span className="min-w-0 flex-1">{label}</span>
                </NavLink>
              )
            }
            return (
              <NavLink
                key={item.id}
                to={to}
                className={`${sidebarSub} ${active ? sidebarSubActive : ''}`}
                onClick={onNavigate}
              >
                <span className={iconCell} aria-hidden>
                  <EsportsRowGlyph item={item} size={iconSize} />
                </span>
                <span className="min-w-0 flex-1">{label}</span>
              </NavLink>
            )
          })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
