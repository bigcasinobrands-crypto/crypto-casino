import { PlayerHeaderWordmark } from './PlayerHeaderLogo'

type Props = {
  /** Extra layout classes (e.g. `min-h-full w-full` for fill parents). */
  className?: string
}

/**
 * Brand preload artwork (gradients + animated wordmark) — shared by app boot overlay and sportsbook loading.
 */
export default function PlayerBootPreloadVisual({ className = '' }: Props) {
  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden bg-[#07090f] ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0b0f1a] via-[#07090f] to-[#05060a]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.16),transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_120%,rgba(15,23,42,0.9),transparent_65%)]"
        aria-hidden
      />

      <div className="relative z-[1] px-6">
        <div className="boot-logo-in">
          <PlayerHeaderWordmark
            size="hero"
            className="!text-transparent bg-gradient-to-r from-white via-white to-white/75 bg-clip-text drop-shadow-[0_0_32px_rgba(99,102,241,0.35)]"
          />
        </div>
      </div>

      <style>{`
        .boot-logo-in {
          animation: playerBootLogo 0.75s ease-out both;
        }
        @keyframes playerBootLogo {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
