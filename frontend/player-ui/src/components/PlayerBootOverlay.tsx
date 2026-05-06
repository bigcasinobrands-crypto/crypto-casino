import { useEffect, useState } from 'react'
import { PlayerHeaderWordmark } from './PlayerHeaderLogo'
import { useSiteContent } from '../hooks/useSiteContent'
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
      className={`fixed inset-0 ${PLAYER_BOOT_OVERLAY_Z} flex flex-col items-center justify-center overflow-hidden bg-[#07090f] transition-opacity ease-out`}
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
      {/* Layered gradient + soft vignette */}
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
