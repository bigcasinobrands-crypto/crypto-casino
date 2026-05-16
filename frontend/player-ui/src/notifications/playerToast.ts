import { toast } from 'sonner'

import type { ApiErr } from '../api/errors'
import { formatApiError } from '../api/errors'
import {
  formatPlayerErrorDebugFooter,
  playerErrorDebugEnabled,
  resolvePlayerApiToastCopy,
  resolvePlayerClientToastCopy,
  resolvePlayerNetworkToastCopy,
} from './playerErrorCopy'

/** Sonner id so health polls update one toast instead of stacking. */
export const PLAYER_CATALOG_SYNC_TOAST_ID = 'player-catalog-sync-warning'

/** Fiat invoice failures replace the same toast instead of stacking on double-submit / retries. */
export const PLAYER_FIAT_DEPOSIT_INVOICE_TOAST_ID = 'player-fiat-deposit-invoice'

export type PlayerToastOpts = {
  skipToast?: boolean
  /** When set, Sonner merges updates into a single visible toast (dedupes rapid repeats). */
  toastId?: string
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

export function toastPlayerApiError(
  parsed: ApiErr | null,
  status: number,
  source: string,
  requestId?: string | null,
  opts?: PlayerToastOpts,
) {
  if (opts?.skipToast) return

  const fallback = formatApiError(parsed, '')
  const resolved = resolvePlayerApiToastCopy(parsed, status, fallback || '')
  let description = resolved.description
  if (playerErrorDebugEnabled()) {
    const dbg = formatPlayerErrorDebugFooter(parsed, status, source, requestId)
    description = description?.trim() ? `${description.trim()}\n\n${dbg}` : dbg
  }
  toast.error(resolved.title, {
    id: opts?.toastId,
    description,
    duration: 14_000,
  })
}

export function toastPlayerNetworkError(message: string, source: string, opts?: PlayerToastOpts) {
  if (opts?.skipToast) return

  const resolved = resolvePlayerNetworkToastCopy(message)
  let description = resolved.description
  if (playerErrorDebugEnabled()) {
    const dbg = `Source: ${source}`
    description = description?.trim() ? `${description.trim()}\n\n${dbg}` : dbg
  }
  toast.error(resolved.title, {
    id: opts?.toastId,
    description,
    duration: 14_000,
  })
}

export function toastPlayerClientError(code: string, message: string, detail?: string) {
  const resolved = resolvePlayerClientToastCopy(code, message, detail)
  toast.error(resolved.title, {
    description: resolved.description,
    duration: 14_000,
  })
}

const CATALOG_SYNC_TOAST_DESCRIPTION =
  'Catalog sync reported a problem. Staff: open Blue Ocean ops, check status, and run Sync catalog again. Game counts in the casino view still reflect the database.'

/** Staff/dev only — players rely on OperationalBanner for catalog health. */
export function toastPlayerCatalogSyncWarning() {
  const raw = String(import.meta.env.VITE_SHOW_CATALOG_SYNC_TOAST || '').toLowerCase()
  const staffOnly = import.meta.env.DEV || raw === 'true' || raw === '1'
  if (!staffOnly) return

  toast.warning('Catalog sync', {
    id: PLAYER_CATALOG_SYNC_TOAST_ID,
    description: CATALOG_SYNC_TOAST_DESCRIPTION,
    duration: Infinity,
  })
}

export function dismissPlayerCatalogSyncToast() {
  toast.dismiss(PLAYER_CATALOG_SYNC_TOAST_ID)
}
