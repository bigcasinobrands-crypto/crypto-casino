import { useContext, useEffect, useLayoutEffect } from 'react'
import { FingerprintContext, useVisitorData } from '@fingerprint/react'
import { bindFingerprintGetVisitorData } from './fingerprintClient'

/**
 * Official @fingerprint/react setup: register the provider agent for imperative helpers +
 * {@link useVisitorData} with `immediate: true` so an identification runs on load (required for
 * the dashboard “Check installation” flow and consistent event_id). Catalog `/v1/games` uses
 * plain `fetch` and does not wait on Fingerprint.
 */
export function FingerprintReactIntegration() {
  const ctx = useContext(FingerprintContext)
  const { error, isFetched, data } = useVisitorData({ immediate: true })

  useLayoutEffect(() => {
    bindFingerprintGetVisitorData(ctx.getVisitorData)
    return () => bindFingerprintGetVisitorData(null)
  }, [ctx.getVisitorData])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(
        '[fingerprint] Identification failed — the dashboard "Event not found" usually means no successful hit yet. Fix: matching public key + VITE_FINGERPRINT_REGION (eu for EU), allowed domains under Fingerprint → Security, disable ad blockers, reload your deployed player URL.',
        error,
      )
      return
    }
    if (isFetched && data && typeof data.event_id === 'string' && data.event_id) {
      // eslint-disable-next-line no-console
      console.info('[fingerprint] Identification succeeded (event_id)', data.event_id)
    }
  }, [error, isFetched, data])

  return null
}
