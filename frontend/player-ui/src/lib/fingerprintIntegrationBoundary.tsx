import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

/**
 * Isolates optional Fingerprint wiring so a thrown error during identification
 * cannot unmount the whole player shell (catalog, routing, etc.).
 */
export class FingerprintIntegrationBoundary extends Component<
  Props,
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[fingerprint] Integration crashed — games and auth still run; fix FP config.', error, info.componentStack)
    }
  }

  render(): ReactNode {
    if (this.state.hasError) return null
    return this.props.children
  }
}
