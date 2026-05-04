import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { fallback: ReactNode; children: ReactNode }

/**
 * If {@link FingerprintProvider} throws while mounting (bad env, SDK fault), render `fallback`
 * — the same player shell **without** Fingerprint — so catalog, routing, and game tiles keep working.
 * Login/withdraw may lack visitor signals until FP is fixed; that is intentional degradation vs a blank app.
 */
export class FingerprintProviderFallbackBoundary extends Component<
  Props,
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(
      '[fingerprint] FingerprintProvider failed — continuing without Fingerprint. Games and lobby still load; verify VITE_FINGERPRINT_PUBLIC_KEY / VITE_FINGERPRINT_REGION.',
      error.message,
      info.componentStack,
    )
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}
