import { oddinIframeEnabled } from '../lib/oddin/oddin.config'
import EsportsComingSoonPage from './EsportsComingSoonPage'
import OddinSportsbookPage from './OddinSportsbookPage'

/**
 * `/casino/sports` — Oddin Bifrost when `VITE_ODDIN_ENABLED`, otherwise a static “coming soon” view.
 * Sidebar + Casino/Sports toggle always link here so E-Sports opens in the main shell.
 */
export default function CasinoSportsPage() {
  if (oddinIframeEnabled()) {
    return <OddinSportsbookPage />
  }
  return <EsportsComingSoonPage />
}
