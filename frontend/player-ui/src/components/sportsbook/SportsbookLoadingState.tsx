import PlayerBootPreloadVisual from '../PlayerBootPreloadVisual'

/** Same brand preload as app boot — covers Oddin bootstrap while iframe mounts. */
export default function SportsbookLoadingState() {
  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col bg-[#07090f]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <PlayerBootPreloadVisual className="min-h-0 flex-1" />
    </div>
  )
}
