import { NavLink, useLocation } from 'react-router-dom'

type HeaderCasinoSportsSegmentProps = {
  className?: string
  /** e.g. close mobile drawer after navigation */
  onNavigate?: () => void
}

/**
 * Joined Casino / Sports control — dark track + purple active pill (`casino-toggle-active`).
 */
export default function HeaderCasinoSportsSegment({
  className = '',
  onNavigate,
}: HeaderCasinoSportsSegmentProps) {
  const { pathname } = useLocation()
  const sportsActive = pathname.startsWith('/casino/sports')
  const casinoActive = pathname.startsWith('/casino') && !sportsActive

  const inner =
    'flex min-h-[34px] min-w-0 flex-1 items-center justify-center rounded-[10px] px-2.5 py-1.5 text-center text-[12px] font-bold leading-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-toggle-active sm:px-3 sm:text-[13px]'

  return (
    <div
      className={`flex max-w-[min(100%,13.5rem)] min-w-[10.5rem] shrink-0 rounded-xl bg-casino-segment-track p-[3px] shadow-[inset_0_2px_6px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.07] ${className}`}
      role="group"
      aria-label="Casino or Sports"
    >
      <NavLink
        to="/casino/games"
        className={`${inner} ${casinoActive ? 'bg-casino-toggle-active text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]' : 'text-casino-muted hover:bg-white/[0.05] hover:text-white/95'}`}
        onClick={onNavigate}
      >
        Casino
      </NavLink>
      <NavLink
        to="/casino/sports"
        className={`${inner} ${sportsActive ? 'bg-casino-toggle-active text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]' : 'text-casino-muted hover:bg-white/[0.05] hover:text-white/95'}`}
        onClick={onNavigate}
      >
        Sports
      </NavLink>
    </div>
  )
}
