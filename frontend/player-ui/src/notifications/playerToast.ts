import { toast } from 'sonner'

import type { ApiErr } from '../api/errors'

/** Sonner id so health polls update one toast instead of stacking. */
export const PLAYER_CATALOG_SYNC_TOAST_ID = 'player-catalog-sync-warning'

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

export function toastPlayerApiError(
  parsed: ApiErr | null,
  status: number,
  source: string,
  requestId?: string | null,
) {
  const code = parsed?.code?.trim() || (status ? `HTTP_${status}` : 'HTTP_ERROR')
  const msg = parsed?.message?.trim() || 'Something went wrong'
  const lines = [
    msg,
    `HTTP ${status}`,
    `Source: ${source}`,
    ...(requestId ? [`Request: ${requestId}`] : []),
  ]
  toast.error(code, {
    description: lines.join('\n'),
    duration: 14_000,
  })
}

export function toastPlayerNetworkError(message: string, source: string) {
  toast.error('network', {
    description: `${message}\nSource: ${source}`,
    duration: 14_000,
  })
}

export function toastPlayerClientError(code: string, message: string, detail?: string) {
  toast.error(code, {
    description: detail ? `${message}\n${detail}` : message,
    duration: 14_000,
  })
}

const CATALOG_SYNC_TOAST_DESCRIPTION =
  'Catalog sync reported a problem. Staff: open Blue Ocean ops, check status, and run Sync catalog again. Game counts in the casino view still reflect the database.'

/** Shown while operational health reports `catalog_sync_ok: false` (deduped by id). */
export function toastPlayerCatalogSyncWarning() {
  toast.warning('Catalog sync', {
    id: PLAYER_CATALOG_SYNC_TOAST_ID,
    description: CATALOG_SYNC_TOAST_DESCRIPTION,
    duration: Infinity,
  })
}

export function dismissPlayerCatalogSyncToast() {
  toast.dismiss(PLAYER_CATALOG_SYNC_TOAST_ID)
}
