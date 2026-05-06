import PlayerBootPreloadVisual from '../PlayerBootPreloadVisual'

/**
 * Brand preload while Oddin mounts — fills the sportsbook shell column only (not full device screen),
 * so header / app chrome stay visible until the iframe is active.
 */
export default function SportsbookLoadingState() {
  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-[#07090f]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <PlayerBootPreloadVisual className="min-h-0 min-w-0 flex-1" />
    </div>
  )
}
