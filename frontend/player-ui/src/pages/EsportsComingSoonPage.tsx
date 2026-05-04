import { Link } from 'react-router-dom'
import { IconChevronLeft } from '../components/icons'

/**
 * Placeholder for `/casino/sports` when Oddin is disabled (legacy Blue Ocean sportsbook not shown here).
 */
export default function EsportsComingSoonPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-4xl shrink-0 px-3 pt-3 sm:px-4 sm:pt-4 lg:max-w-5xl">
        <div className="w-full shrink-0 overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-2 py-1.5 sm:gap-2 sm:px-3">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              <Link
                to="/casino/games"
                className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10 hover:text-white sm:gap-1 sm:px-2 sm:py-1.5 sm:text-xs"
              >
                <IconChevronLeft size={14} aria-hidden />
                <span className="hidden sm:inline">Games</span>
              </Link>
              <span className="rounded bg-white/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white/85 sm:px-2 sm:py-0.5 sm:text-[10px]">
                E-Sports
              </span>
            </div>
          </div>
          <div className="flex min-h-[min(360px,60vh)] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <h1 className="text-lg font-semibold text-white sm:text-xl">E-Sports</h1>
            <p className="text-sm text-casino-muted">Coming soon.</p>
            <Link
              to="/casino/games"
              className="mt-2 text-sm font-medium text-casino-primary underline-offset-2 hover:underline"
            >
              Back to games
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
