import { useContext, useEffect } from 'react'
import { FingerprintContext, useVisitorData } from '@fingerprint/react'
import { bindFingerprintGetVisitorData } from './fingerprintClient'

/**
 * Official @fingerprint/react setup: register the provider agent for imperative helpers +
 * {@link useVisitorData} with `immediate: true` so an identification runs on load (required for
 * the dashboard “Check installation” flow and consistent event_id). Catalog `/v1/games` uses
 * plain `fetch` and does not wait on Fingerprint.
 *
 * We bind `getVisitorData` synchronously during render so it is available before sibling
 * `BrowserRouter`/`App` render — otherwise login could run before `useLayoutEffect` and miss `requestId`.
 */
export function FingerprintReactIntegration() {
  const ctx = useContext(FingerprintContext)
  bindFingerprintGetVisitorData(ctx.getVisitorData)

  const { error, isFetched, data } = useVisitorData({ immediate: true })

  useEffect(() => {
    return () => bindFingerprintGetVisitorData(null)
  }, [])

  useEffect(() => {
    if (error) {
      console.warn(
        '[fingerprint] Identification failed — "Event not found" in the dashboard: matching VITE_FINGERPRINT_PUBLIC_KEY, VITE_FINGERPRINT_REGION (eu/us/ap) with your Fingerprint app, Security → allowed domains for this origin, ad blockers off.',
        error,
      )
      return
    }
    if (import.meta.env.DEV && isFetched && data && typeof data.event_id === 'string' && data.event_id) {
      console.info('[fingerprint] Identification succeeded (event_id)', data.event_id)
    }
  }, [error, isFetched, data])

  return null
}
