import { toast } from 'sonner'

import type { ApiErr } from '../api/errors'

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/** Toast for API failures (admin). */
export function toastApiError(
  parsed: ApiErr | null,
  status: number,
  source: string,
  requestId?: string | null,
) {
  const code = parsed?.code?.trim() || (status ? `HTTP_${status}` : 'HTTP_ERROR')
  const msg = parsed?.message?.trim() || 'Request failed'
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

export function toastClientError(code: string, message: string, detail?: string) {
  toast.error(code, {
    description: detail ? `${message}\n${detail}` : message,
    duration: 14_000,
  })
}
