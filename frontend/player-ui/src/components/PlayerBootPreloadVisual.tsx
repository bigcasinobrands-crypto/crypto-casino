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

      <div className="relative z-[1] mx-auto box-border w-max max-w-[min(100%,calc(100vw-3rem))] shrink-0 px-6">
        <div className="boot-logo-in">
          <PlayerHeaderWordmark
            size="hero"
            className="boot-wordmark-shimmer drop-shadow-[0_0_28px_rgba(148,163,184,0.5)]"
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

        /*
         * Two layers (both clipped to text): steady silver base + sliding highlight.
         * Base keeps glyphs readable; highlight repeats forever without "blank" frames.
         */
        .boot-wordmark-shimmer {
          color: transparent !important;
          -webkit-background-clip: text;
          background-clip: text;
          background-image: linear-gradient(
              105deg,
              transparent 0%,
              rgba(255, 255, 255, 0.15) 40%,
              rgba(255, 255, 255, 0.95) 50%,
              rgba(255, 255, 255, 0.15) 60%,
              transparent 72%
            ),
            linear-gradient(105deg, #c5ced9 0%, #eef2f7 32%, #ffffff 48%, #dce4ee 68%, #aeb9c8 100%);
          background-size: 240% 120%, 100% 100%;
          background-position: 140% 50%, 0% 50%;
          background-repeat: no-repeat, no-repeat;
          animation-name: bootSilverShimmer;
          animation-duration: 2.75s;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          animation-direction: alternate;
          animation-fill-mode: none;
          animation-delay: 0.72s;
        }

        @keyframes bootSilverShimmer {
          from {
            background-position: 130% 50%, 0% 50%;
          }
          to {
            background-position: -130% 50%, 0% 50%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .boot-wordmark-shimmer {
            animation: none;
            background-image: linear-gradient(180deg, #f8fafc, #e2e8f0);
            background-size: 100% 100%;
            background-position: 0% 50%;
          }
        }
      `}</style>
    </div>
  )
}
