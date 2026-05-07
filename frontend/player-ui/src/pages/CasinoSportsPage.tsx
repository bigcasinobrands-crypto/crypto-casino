import { useLayoutEffect } from 'react'
import { useOddinBootstrap } from '../context/OddinBootstrapContext'
import { useCompleteInitialLoad } from '../context/InitialAppLoadContext'
import SportsbookLoadingState from '../components/sportsbook/SportsbookLoadingState'
import { oddinBifrostUsable } from '../lib/oddin/oddin.config'
import EsportsComingSoonPage from './EsportsComingSoonPage'
import OddinSportsbookPage from './OddinSportsbookPage'

/**
 * `/casino/sports` — Oddin Bifrost when env validates either from **player** `VITE_ODDIN_*` or **core**
 * `GET /v1/sportsbook/oddin/public-config` (ODDIN_BRAND_TOKEN + ODDIN_PUBLIC_BASE_URL + ODDIN_PUBLIC_SCRIPT_URL).
 */
export default function CasinoSportsPage() {
  const completeInitialLoad = useCompleteInitialLoad()
  const viteOnlyUsable = oddinBifrostUsable()
  const { bootstrapReady, oddinBifrostUsable: mergedUsable, mergedPublicConfig } = useOddinBootstrap()

  useLayoutEffect(() => {
    completeInitialLoad()
  }, [completeInitialLoad])

  if (!viteOnlyUsable && !bootstrapReady) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SportsbookLoadingState />
      </div>
    )
  }

  if (mergedUsable && mergedPublicConfig) {
    return <OddinSportsbookPage publicConfig={mergedPublicConfig} />
  }
  return <EsportsComingSoonPage />
}
