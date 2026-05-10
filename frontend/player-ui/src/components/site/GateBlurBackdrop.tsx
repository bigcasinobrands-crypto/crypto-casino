import PlayerBootPreloadVisual from '../PlayerBootPreloadVisual'

/**
 * Full-viewport blurred layer matching the player shell preload / home aesthetic (not a live DOM capture of the lobby).
 */
export function GateBlurBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-[-14%] min-h-[125vh] min-w-[125vw] origin-center scale-[1.06] blur-[36px] saturate-[1.08]">
        <PlayerBootPreloadVisual className="min-h-[125vh] min-w-full flex-none" />
      </div>
      <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-casino-bg)_72%,transparent)] backdrop-blur-md" />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_20%,color-mix(in_srgb,var(--color-casino-primary)_18%,transparent),transparent_62%)] opacity-90"
        aria-hidden
      />
    </div>
  )
}
