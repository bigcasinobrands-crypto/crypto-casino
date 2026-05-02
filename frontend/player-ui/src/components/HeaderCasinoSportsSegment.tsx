import { Link } from 'react-router-dom'

type HeaderCasinoSportsSegmentProps = {
  className?: string
  /** e.g. close mobile drawer after navigation */
  onNavigate?: () => void
}

/**
 * Joined Casino / Sports control — dark track + purple active pill (`casino-toggle-active`).
 * Casino stays visually selected in this shell: the sidebar and routes here are casino-first;
 * Sports opens the external sportsbook iframe while the segment still reads as “Casino” selected.
 */
export default function HeaderCasinoSportsSegment({
  className = '',
  onNavigate,
}: HeaderCasinoSportsSegmentProps) {
  const inner =
    'flex min-h-[34px] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[10px] px-1.5 py-1.5 text-center text-[11px] font-bold leading-tight transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-toggle-active sm:px-3 sm:text-[12px] md:text-[13px]'

  const casinoActive =
    `${inner} bg-casino-toggle-active text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]`
  const sportsIdle =
    `${inner} text-casino-muted hover:bg-white/[0.05] hover:text-white/95`

  return (
    <div
      className={`flex min-w-0 max-w-full shrink rounded-xl bg-casino-segment-track p-[3px] shadow-[inset_0_2px_6px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.07] ${className}`}
      role="group"
      aria-label="Casino or Sports"
    >
      <Link to="/casino/games" className={casinoActive} onClick={onNavigate}>
        Casino
      </Link>
      <Link to="/casino/sports" className={sportsIdle} onClick={onNavigate}>
        Sports
      </Link>
    </div>
  )
}
