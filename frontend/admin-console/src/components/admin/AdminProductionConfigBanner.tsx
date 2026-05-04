import { adminApiOriginConfigured } from '../../lib/adminApiUrl'

/**
 * Shown on every authenticated admin page when the SPA was built for production
 * but no API origin was baked in — API calls hit the static host (404). Matches LoginPage warning.
 */
export default function AdminProductionConfigBanner() {
  if (!import.meta.env.PROD || adminApiOriginConfigured()) return null
  return (
    <div className="alert alert-danger border-danger mb-3 py-2 px-3 small" role="alert">
      <strong className="d-block mb-1">Admin API origin missing</strong>
      Set <code className="small">VITE_ADMIN_API_ORIGIN</code> to your core API HTTPS origin (Vercel / Netlify env),
      redeploy, and add this admin URL to <code className="small">ADMIN_CORS_ORIGINS</code> on the API. Until then,
      saves from this panel will not reach staging/production — locally you use Vite&apos;s <code className="small">/v1</code>{' '}
      proxy, which is why it worked on your machine.
    </div>
  )
}
