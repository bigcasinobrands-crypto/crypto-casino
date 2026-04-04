import type { FC, ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { RequireAuthLink } from './RequireAuthLink'
import {
  IconBanknote,
  IconBuilding2,
  IconGem,
  IconRadio,
  IconSwords,
} from './icons'

const pillBase =
  'inline-flex shrink-0 items-center gap-2 rounded-[4px] px-3 py-2 text-[12px] font-semibold whitespace-nowrap transition'
const pillIdle = 'text-casino-muted hover:bg-casino-elevated/80'
const pillActive = 'bg-casino-primary text-white'

type PillDef = {
  key: string
  to: string
  label: string
  icon?: FC<{ size?: number; className?: string }>
  match: (path: string, hash: string) => boolean
}

function casinoSection(pathname: string) {
  const m = pathname.match(/^\/casino\/([^/?#]+)/)
  return m?.[1] ?? ''
}

const PILLS: PillDef[] = [
  {
    key: 'lobby',
    to: '/casino/games',
    label: 'Lobby',
    match: (path, hash) => casinoSection(path) === 'games' && !hash,
  },
  {
    key: 'hot',
    to: '/casino/featured',
    label: 'Hot now',
    icon: IconSwords,
    match: (path) => path.includes('/casino/featured'),
  },
  {
    key: 'slots',
    to: '/casino/slots',
    label: 'Slots',
    icon: IconGem,
    match: (path) => path.includes('/casino/slots'),
  },
  {
    key: 'live',
    to: '/casino/live',
    label: 'Live Casino',
    icon: IconRadio,
    match: (path) => path.includes('/casino/live'),
  },
  {
    key: 'bonus',
    to: '/casino/bonus-buys',
    label: 'Bonus Buys',
    icon: IconBanknote,
    match: (path) => path.includes('/casino/bonus-buys'),
  },
  {
    key: 'providers',
    to: '/casino/games#providers',
    label: 'Providers',
    icon: IconBuilding2,
    match: (path, hash) => hash === '#providers' && casinoSection(path) === 'games',
  },
]

const CasinoCategoryPills: FC = () => {
  const { pathname, hash } = useLocation()

  return (
    <div
      className="scrollbar-none mb-6 flex items-center gap-2.5 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Game categories"
    >
      {PILLS.map((p) => {
        const active = p.match(pathname, hash)
        const Ic = p.icon
        let content: ReactNode = p.label
        if (Ic) {
          content = (
            <>
              <Ic size={15} className="shrink-0 opacity-90" aria-hidden />
              {p.label}
            </>
          )
        }
        const TabLink = p.key === 'lobby' ? Link : RequireAuthLink
        return (
          <TabLink
            key={p.key}
            to={p.to}
            role="tab"
            aria-selected={active}
            className={`${pillBase} ${active ? pillActive : pillIdle}`}
          >
            {content}
          </TabLink>
        )
      })}
    </div>
  )
}

export default CasinoCategoryPills
