import {
  isCrossAppEnvelope,
  playerAppHref,
  postCrossApp,
  resolvePlayerAppOrigin,
} from '@repo/cross-app'
import { useCallback, useEffect, useRef, useState, type FC } from 'react'

type BridgeState = 'idle' | 'ok' | 'fail'

/**
 * Links the admin console to the separate player UI deployable (different origin in prod).
 * Uses a named window + postMessage ping/pong so both apps stay decoupled at build time.
 */
const PlayerConsoleBar: FC = () => {
  const playerUrl = playerAppHref(import.meta.env, '/')
  const playerOrigin = resolvePlayerAppOrigin(import.meta.env)
  const playerWin = useRef<Window | null>(null)
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [bridge, setBridge] = useState<BridgeState>('idle')

  const clearFailTimer = useCallback(() => {
    if (failTimer.current) {
      clearTimeout(failTimer.current)
      failTimer.current = null
    }
  }, [])

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== playerOrigin) return
      if (!isCrossAppEnvelope(ev.data)) return
      if (ev.data.payload.type !== 'player.pong') return
      clearFailTimer()
      setBridge('ok')
    }
    window.addEventListener('message', onMsg)
    return () => {
      clearFailTimer()
      window.removeEventListener('message', onMsg)
    }
  }, [playerOrigin, clearFailTimer])

  const ensurePlayerWindow = useCallback(() => {
    let w = playerWin.current
    if (!w || w.closed) {
      w = window.open(playerUrl, 'crypto-casino-player-ui', 'noopener,noreferrer')
      playerWin.current = w
    }
    return w
  }, [playerUrl])

  const verifyBridge = useCallback(() => {
    const w = ensurePlayerWindow()
    if (!w) {
      setBridge('fail')
      return
    }
    clearFailTimer()
    setBridge('idle')
    postCrossApp(
      w,
      { type: 'admin.ping', requestId: crypto.randomUUID() },
      playerOrigin,
    )
    failTimer.current = setTimeout(() => {
      setBridge((b) => (b === 'idle' ? 'fail' : b))
      failTimer.current = null
    }, 3000)
  }, [ensurePlayerWindow, playerOrigin, clearFailTimer])

  return (
    <div className="mr-3 hidden items-center gap-2 border-r border-gray-200 pr-3 dark:border-gray-800 lg:flex">
      <a
        href={playerUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-gray-600 hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-400"
      >
        Player app
      </a>
      <button
        type="button"
        onClick={() => void verifyBridge()}
        className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-brand-700 dark:hover:text-brand-400"
      >
        Verify bridge
      </button>
      {bridge === 'ok' ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">Linked</span>
      ) : null}
      {bridge === 'fail' ? (
        <span className="max-w-[140px] text-xs text-amber-600 dark:text-amber-400" title="Open player app on the configured origin, then try again.">
          No handshake
        </span>
      ) : null}
    </div>
  )
}

export default PlayerConsoleBar
