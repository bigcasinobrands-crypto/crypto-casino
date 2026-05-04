import { useContext, useEffect, useLayoutEffect } from 'react'
import { FingerprintContext, useVisitorData } from '@fingerprint/react'
import { bindFingerprintGetVisitorData } from './fingerprintClient'

/**
 * Official @fingerprint/react setup: register the provider agent for imperative helpers +
 * {@link useVisitorData} with `immediate: true` so an identification runs on load (required for
 * the dashboard “Check installation” flow and consistent event_id). Catalog `/v1/games` uses
 * plain `fetch` and does not wait on Fingerprint.
 *
 * Binding runs in `useLayoutEffect` with `[ctx.getVisitorData]` so module state never keeps a stale
 * `getVisitorData` when the provider updates, and we avoid side effects during render.
 * `waitForFingerprintVisitorBinding` in `fingerprintClient` covers the short window before the first
 * layout commit for login/sign-in.
 */
export function FingerprintReactIntegration() {
  const ctx = useContext(FingerprintContext)
  const { error, isFetched, data } = useVisitorData({ immediate: true })

  useLayoutEffect(() => {
    bindFingerprintGetVisitorData(ctx.getVisitorData)
    return () => bindFingerprintGetVisitorData(null)
  }, [ctx.getVisitorData])

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
