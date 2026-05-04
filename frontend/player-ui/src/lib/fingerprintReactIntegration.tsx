import { useContext, useLayoutEffect } from 'react'
import { FingerprintContext, useVisitorData } from '@fingerprint/react'
import { bindFingerprintGetVisitorData } from './fingerprintClient'

/**
 * Official @fingerprint/react setup: register the provider agent for imperative helpers +
 * {@link useVisitorData} with `immediate: true` so the dashboard “Verify installation” receives an event on load.
 */
export function FingerprintReactIntegration() {
  const ctx = useContext(FingerprintContext)
  useLayoutEffect(() => {
    bindFingerprintGetVisitorData(ctx.getVisitorData)
    return () => bindFingerprintGetVisitorData(null)
  }, [ctx.getVisitorData])
  useVisitorData({ immediate: true })
  return null
}
