import { Component, type ErrorInfo, type ReactNode } from 'react'

import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'

type Props = { children: ReactNode }

class ErrorBoundaryInner extends Component<
  Props & { onCatch: (err: Error, info: ErrorInfo) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onCatch(error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            A client error was recorded. You can reload the page or open Logs for details.
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white"
            onClick={() => window.location.reload()}
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
