import { Navigate, useSearchParams } from 'react-router-dom'

/** Legacy standalone route; catalog deep-links use `/bonushub?tab=`. */
export default function BonusHubOperationsPage() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const search = tab ? `?tab=${encodeURIComponent(tab)}` : ''
  return <Navigate to={`/bonushub${search}`} replace />
}
