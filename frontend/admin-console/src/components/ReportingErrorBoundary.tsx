import { Component, type ErrorInfo, type ReactNode, useEffect } from 'react'

import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import {
  ADMIN_CHUNK_RECOVER_SESSION_KEY,
  isStaleLazyChunkError,
  scheduleClearChunkRecoverKey,
} from '../lib/staleChunkReload'

type Props = { children: ReactNode }

function normalizeBoundaryError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

class ErrorBoundaryInner extends Component<
  Props & { onCatch: (err: Error, info: ErrorInfo) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    const e = normalizeBoundaryError(error)
    if (isStaleLazyChunkError(e)) {
      try {
        if (sessionStorage.getItem(ADMIN_CHUNK_RECOVER_SESSION_KEY)) {
          return { error: e }
        }
      } catch {
        /* ignore */
      }
      return null
    }
    return { error: e }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const e = normalizeBoundaryError(error)
    if (isStaleLazyChunkError(e)) {
      try {
        if (!sessionStorage.getItem(ADMIN_CHUNK_RECOVER_SESSION_KEY)) {
          sessionStorage.setItem(ADMIN_CHUNK_RECOVER_SESSION_KEY, '1')
          window.location.reload()
          return
        }
        sessionStorage.removeItem(ADMIN_CHUNK_RECOVER_SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
    this.props.onCatch(e, info)
  }

  render() {
    if (this.state.error) {
      const stale = isStaleLazyChunkError(this.state.error)
      return (
        <div className="mx-auto max-w-lg p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {stale
              ? 'This usually happens after a new deployment: the app updated but this tab still had an old page open. Reload to load the latest assets.'
              : 'A client error was recorded. You can reload the page or open Logs for details.'}
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white"
            onClick={() => {
              try {
                sessionStorage.removeItem(ADMIN_CHUNK_RECOVER_SESSION_KEY)
              } catch {
                /* ignore */
              }
              window.location.reload()
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function ReportingErrorBoundary({ children }: Props) {
  const { reportClientError } = useAdminActivityLog()

  useEffect(() => {
    return scheduleClearChunkRecoverKey(5000)
  }, [])

  return (
    <ErrorBoundaryInner
      onCatch={(err, info) => {
        reportClientError({
          code: 'react_render',
          message: err.message || 'Render error',
          detail: import.meta.env.DEV ? `${info.componentStack?.slice(0, 2000) ?? ''}` : undefined,
        })
      }}
    >
      {children}
    </ErrorBoundaryInner>
  )
}
