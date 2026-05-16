import { adminApiOriginConfigured } from '../../lib/adminApiUrl'

/**
 * Shown on every authenticated admin page when the SPA was built for production
 * but no API origin was baked in — relative `/v1` calls hit the static host (405 on writes if no Edge proxy).
 * Matches LoginPage warning.
 */
export default function AdminProductionConfigBanner() {
  if (!import.meta.env.PROD || adminApiOriginConfigured()) return null
  return (
    <div className="alert alert-danger border-danger mb-3 py-2 px-3 small" role="alert">
      <strong className="d-block mb-1">Admin API origin missing</strong>
      Either set <code className="small">VITE_ADMIN_API_ORIGIN</code> to your core API HTTPS origin and redeploy,{' '}
      <strong>or</strong> set <code className="small">CORE_API_ORIGIN</code> on Vercel so Edge middleware can proxy{' '}
      <code className="small">/v1/*</code> (otherwise POST/PATCH return <strong>405</strong> because the SPA fallback only allows GET).
      Add this admin URL to <code className="small">ADMIN_CORS_ORIGINS</code> on the API when using the baked-in origin.
      Locally, Vite&apos;s <code className="small">/v1</code> proxy is why saves work on your machine.
    </div>
  )
}
