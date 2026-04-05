import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { ApiErr } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { toastApiError, toastClientError, truncate } from './adminToast'

const LAST_VISIT_KEY = 'admin_logs_last_visit_at'

export type IngestClientLogBody = {
  severity: 'error' | 'warning' | 'info'
  code: string
  http_status: number
  message: string
  source: string
  request_id?: string
  detail?: string
  client_build?: string
}

type Ctx = {
  unreadCount: number
  refreshUnread: () => Promise<void>
  markLogsVisited: () => void
  reportApiFailure: (args: {
    res: Response
    parsed: ApiErr | null
    method: string
    path: string
    skipServerLog?: boolean
  }) => void
  reportNetworkFailure: (args: {
    message: string
    method: string
    path: string
    skipServerLog?: boolean
  }) => void
  reportClientError: (args: { code: string; message: string; detail?: string }) => void
}

const ActivityCtx = createContext<Ctx | null>(null)

export function AdminActivityLogProvider({ children }: { children: ReactNode }) {
  const { apiFetch, accessToken } = useAdminAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  const refreshUnread = useCallback(async () => {
    if (!accessToken) {
      setUnreadCount(0)
      return
    }
    let after = ''
    try {
      after = localStorage.getItem(LAST_VISIT_KEY) ?? ''
    } catch {
      /* ignore */
    }
    const q = after ? `?after=${encodeURIComponent(after)}` : ''
    const res = await apiFetch(`/v1/admin/client-logs/count${q}`)
    if (!res.ok) return
    const j = (await res.json()) as { count: number }
    setUnreadCount(typeof j.count === 'number' ? j.count : 0)
  }, [apiFetch, accessToken])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void refreshUnread()
    })
    const id = window.setInterval(() => void refreshUnread(), 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [refreshUnread])

  const markLogsVisited = useCallback(() => {
    try {
      localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString())
    } catch {
      /* ignore */
    }
    setUnreadCount(0)
  }, [])

  const ingestClientLog = useCallback(
    async (body: IngestClientLogBody, skipServer?: boolean) => {
      if (!accessToken || skipServer) return
      try {
        const res = await apiFetch('/v1/admin/client-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            client_build: body.client_build ?? import.meta.env.MODE,
          }),
        })
        if (res.ok) void refreshUnread()
      } catch {
        /* non-blocking */
      }
    },
    [accessToken, apiFetch, refreshUnread],
  )

  const reportApiFailure = useCallback(
    (args: {
      res: Response
      parsed: ApiErr | null
      method: string
      path: string
      skipServerLog?: boolean
    }) => {
      const { res, parsed, method, path, skipServerLog } = args
      const status = res.status
      const code = parsed?.code?.trim() || (status ? `HTTP_${status}` : 'HTTP_ERROR')
      const msg = parsed?.message?.trim() || 'Request failed'
      const source = `${method} ${truncate(path, 240)}`
      const rid =
        res.headers.get('X-Request-Id')?.trim() ||
        res.headers.get('X-Request-ID')?.trim() ||
        undefined

      toastApiError(parsed, status, source, rid)

      void ingestClientLog(
        {
          severity: 'error',
          code,
          http_status: status,
          message: truncate(msg, 2000),
          source,
          request_id: rid,
          client_build: import.meta.env.MODE,
        },
        skipServerLog,
      )
    },
    [ingestClientLog],
  )

  const reportNetworkFailure = useCallback(
    (args: { message: string; method: string; path: string; skipServerLog?: boolean }) => {
      const source = `${args.method} ${truncate(args.path, 240)}`
      toastClientError('network', args.message, `Source: ${source}`)
      void ingestClientLog(
        {
          severity: 'error',
          code: 'network',
          http_status: 0,
          message: truncate(args.message, 2000),
          source,
          client_build: import.meta.env.MODE,
        },
        args.skipServerLog,
      )
    },
    [ingestClientLog],
  )

  const reportClientError = useCallback(
    (args: { code: string; message: string; detail?: string }) => {
      toastClientError(args.code, args.message, args.detail)
      void ingestClientLog(
        {
          severity: 'error',
          code: truncate(args.code, 128),
          http_status: 0,
          message: truncate(args.message, 2000),
          source: 'client',
          detail: args.detail ? truncate(args.detail, 4000) : undefined,
          client_build: import.meta.env.MODE,
        },
        false,
      )
    },
    [ingestClientLog],
  )

  const reportRef = useRef(reportClientError)
  useLayoutEffect(() => {
    reportRef.current = reportClientError
  }, [reportClientError])

  useEffect(() => {
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason
      const msg =
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unknown rejection'
      reportRef.current({
        code: 'unhandled_rejection',
        message: truncate(msg, 800),
      })
    }
    const onWinError = (ev: ErrorEvent) => {
      const fn = ev.filename ?? ''
      if (fn.includes('chrome-extension://') || fn.includes('moz-extension://')) return
      reportRef.current({
        code: 'window_error',
        message: ev.message || 'Script error',
        detail: import.meta.env.DEV ? `${ev.filename}:${ev.lineno}` : undefined,
      })
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    window.addEventListener('error', onWinError)
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled)
      window.removeEventListener('error', onWinError)
    }
  }, [])

  const v = useMemo(
    () => ({
      unreadCount,
      refreshUnread,
      markLogsVisited,
      reportApiFailure,
      reportNetworkFailure,
      reportClientError,
    }),
    [
      unreadCount,
      refreshUnread,
      markLogsVisited,
      reportApiFailure,
      reportNetworkFailure,
      reportClientError,
    ],
  )

  return <ActivityCtx.Provider value={v}>{children}</ActivityCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with provider
export function useAdminActivityLog() {
  const x = useContext(ActivityCtx)
  if (!x) throw new Error('AdminActivityLogProvider missing')
  return x
}
