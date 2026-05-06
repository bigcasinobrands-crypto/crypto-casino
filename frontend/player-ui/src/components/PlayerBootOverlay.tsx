import { useEffect, useState } from 'react'
import { useSiteContent } from '../hooks/useSiteContent'
import PlayerBootPreloadVisual from './PlayerBootPreloadVisual'
import { PLAYER_BOOT_OVERLAY_Z } from '../lib/playerChromeLayers'

const FADE_MS = 480

/**
 * Full-viewport preload: blocks the entire player UI until site bundle work finishes and
 * optional paint frames complete — avoids hero/tile/layout flashes on refresh.
 */
export default function PlayerBootOverlay() {
  const { shellReady } = useSiteContent()
  const [mounted, setMounted] = useState(true)
  const [fade, setFade] = useState(false)

  useEffect(() => {
    if (!shellReady) return
    setFade(true)
  }, [shellReady])

  if (!mounted) return null

  return (
    <div
      className={`fixed inset-0 ${PLAYER_BOOT_OVERLAY_Z} flex min-h-dvh h-dvh w-full max-w-[100vw] flex-col overflow-hidden transition-opacity ease-out`}
      style={{
        transitionDuration: `${FADE_MS}ms`,
        opacity: fade ? 0 : 1,
        pointerEvents: fade ? 'none' : 'auto',
      }}
      aria-hidden={fade}
      onTransitionEnd={() => {
        if (fade) setMounted(false)
      }}
    >
      <PlayerBootPreloadVisual className="min-h-full min-w-full flex-1" />
    </div>
  )
}
