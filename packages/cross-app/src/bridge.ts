import type { CrossAppViteEnv } from './env'
import { resolveAdminAppOrigin } from './env'

/**
 * Cross-origin postMessage envelope so the admin console (one origin) and
 * player UI (another origin) can handshake without sharing JS bundles.
 */
export const CROSS_APP_MESSAGE_CHANNEL = 'crypto-casino-cross-app-v1' as const

export type CrossAppPayload =
  | { type: 'admin.ping'; requestId: string }
  | { type: 'player.pong'; requestId: string; playerAppUrl: string }

export function isCrossAppPayload(x: unknown): x is CrossAppPayload {
  if (!x || typeof x !== 'object') return false
  const t = (x as { type?: string }).type
  if (t === 'admin.ping') {
    return typeof (x as { requestId?: unknown }).requestId === 'string'
  }
  if (t === 'player.pong') {
    const p = x as { requestId?: unknown; playerAppUrl?: unknown }
    return typeof p.requestId === 'string' && typeof p.playerAppUrl === 'string'
  }
  return false
}

export function isCrossAppEnvelope(
  data: unknown,
): data is { channel: string; payload: CrossAppPayload } {
  if (!data || typeof data !== 'object') return false
  const o = data as Record<string, unknown>
  return (
    o.channel === CROSS_APP_MESSAGE_CHANNEL &&
    isCrossAppPayload(o.payload)
  )
}

export function postCrossApp(
  target: Window,
  payload: CrossAppPayload,
  targetOrigin: string,
): void {
  target.postMessage(
    { channel: CROSS_APP_MESSAGE_CHANNEL, payload },
    targetOrigin,
  )
}

/**
 * Player UI: accept pings from the configured admin origin and reply with pong.
 */
export function installPlayerCrossAppBridge(env: CrossAppViteEnv): () => void {
  const adminOrigin = resolveAdminAppOrigin(env)
  const handler = (ev: MessageEvent) => {
    if (!isCrossAppEnvelope(ev.data)) return
    if (ev.origin !== adminOrigin) return
    const src = ev.source as Window | null
    if (!src || ev.data.payload.type !== 'admin.ping') return
    postCrossApp(
      src,
      {
        type: 'player.pong',
        requestId: ev.data.payload.requestId,
        playerAppUrl: window.location.origin,
      },
      adminOrigin,
    )
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
