import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { IconChevronRight } from './icons'

/** Show RTP after ~1s hold — quick enough to avoid feeling sluggish. */
const LONG_HOVER_MS = 1000

type Props = {
  /** From `GET /v1/games` when `games.metadata` includes `effective_rtp_pct` or `theoretical_rtp_pct`. */
  effectiveRtpPct?: number | null
  children: ReactNode
}

/** Long-hover “effective RTP” overlay on lobby-style tiles (elevation + glow live on `.game-thumb-link`). */
export const GameThumbInteractiveShell: FC<Props> = ({ effectiveRtpPct, children }) => {
  const { t } = useTranslation()
  const reduceMotion = usePrefersReducedMotion()
  const [rtpVisible, setRtpVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => () => clearTimer(), [clearTimer])

  const hasRtp =
    effectiveRtpPct != null && typeof effectiveRtpPct === 'number' && !Number.isNaN(effectiveRtpPct)

  const onEnter = () => {
    if (!hasRtp || reduceMotion) return
    clearTimer()
    setRtpVisible(false)
    timerRef.current = window.setTimeout(() => setRtpVisible(true), LONG_HOVER_MS)
  }

  const onLeave = () => {
    clearTimer()
    setRtpVisible(false)
  }

  return (
    <div
      className="relative h-full min-h-0 w-full"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
      {hasRtp ? (
        <div
          className={`pointer-events-none absolute inset-0 z-[2] flex flex-col overflow-hidden rounded-casino-md transition-opacity duration-300 ease-out ${
            rtpVisible ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden={!rtpVisible}
        >
          {/* Semi-transparent scrim so thumbnail art stays visible (reference: ~55–70% combined opacity + light brand tint). */}
          <div className="absolute inset-0 rounded-casino-md bg-black/50" aria-hidden />
          <div
            className="absolute inset-0 rounded-casino-md bg-gradient-to-b from-black/25 via-casino-primary/[0.14] to-black/55"
            aria-hidden
          />
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-3 text-center">
            <IconChevronRight className="mb-3 shrink-0 text-white/90" size={22} aria-hidden />
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
              {t('lobby.gameTile.effectiveRtp')}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-bold tabular-nums leading-none tracking-tight text-white">
              {effectiveRtpPct.toFixed(2)}%
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
