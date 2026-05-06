import { useLayoutEffect } from 'react'
import { useCompleteInitialLoad } from '../context/InitialAppLoadContext'
import { oddinBifrostUsable } from '../lib/oddin/oddin.config'
import EsportsComingSoonPage from './EsportsComingSoonPage'
import OddinSportsbookPage from './OddinSportsbookPage'

/**
 * `/casino/sports` — Oddin Bifrost only when `VITE_ODDIN_ENABLED` and brand token + Bifrost URLs are set; otherwise “coming soon”.
 * (Flag alone without Oddin onboarding values no longer shows a configuration error page.)
 */
export default function CasinoSportsPage() {
  const completeInitialLoad = useCompleteInitialLoad()
  useLayoutEffect(() => {
    completeInitialLoad()
  }, [completeInitialLoad])

  if (oddinBifrostUsable()) {
    return <OddinSportsbookPage />
  }
  return <EsportsComingSoonPage />
}
