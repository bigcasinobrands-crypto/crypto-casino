import { useEffect, useState, type FC, type ReactNode } from 'react'
import { useSharedOperationalHealth } from '../../context/OperationalHealthContext'
import {
  subscribePlayerSiteBarrier,
  type PlayerSiteBarrierCode,
} from '../../lib/playerBarrierSync'
import PlayerBootPreloadVisual from '../PlayerBootPreloadVisual'
import { GateBlurBackdrop } from './GateBlurBackdrop'
import { IpRestrictedScreen } from './IpRestrictedScreen'
import { MaintenanceScreen } from './MaintenanceScreen'
import { RegionRestrictedScreen } from './RegionRestrictedScreen'

const SUPPORT_EMAIL =
  (import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL as string | undefined)?.trim() || 'support@vybebet.com'

/** Same branded preload as {@link PlayerBootOverlay}; gate blocks children until ops-health resolves. */
function GateLoading() {
  return (
    <div
      className="flex h-dvh min-h-dvh w-full max-w-[100vw] flex-col overflow-hidden bg-black"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <PlayerBootPreloadVisual className="min-h-full min-w-full flex-1" />
    </div>
  )
}

export const SiteAccessGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { data, ready, reload } = useSharedOperationalHealth()
  const [forcedBarrier, setForcedBarrier] = useState<PlayerSiteBarrierCode | null>(null)

  useEffect(() => {
    return subscribePlayerSiteBarrier((code) => setForcedBarrier(code))
  }, [])

  /** `/health/operational` is authoritative; drop stale barrier codes from older API errors (avoids maintenance overlay after ops opens). */
  useEffect(() => {
    if (!ready || !data) return
    const maint = Boolean(data.maintenance_mode)
    const geo = Boolean(data.geo_blocked)
    const ip = Boolean(data.ip_blocked)

    setForcedBarrier((prev) => {
      if (prev === null) return null
      if (prev === 'site_maintenance' && !maint) return null
      if (prev === 'geo_blocked' && !geo) return null
      if (prev === 'ip_blocked' && !ip) return null
      return prev
    })
  }, [ready, data])

  const geoBlocked = Boolean(data?.geo_blocked) || forcedBarrier === 'geo_blocked'
  const ipBlocked = Boolean(data?.ip_blocked) || forcedBarrier === 'ip_blocked'
  const maintenanceOn = Boolean(data?.maintenance_mode) || forcedBarrier === 'site_maintenance'

  /** While the maintenance card is up, poll aggressively so turning maintenance off in admin clears within ~1s of API consistency. */
  useEffect(() => {
    if (!ready || !maintenanceOn) return
    void reload()
    const turboId = window.setInterval(() => void reload(), 900)
    return () => window.clearInterval(turboId)
  }, [ready, maintenanceOn, reload])

  useEffect(() => {
    const lockScroll = !ready || geoBlocked || ipBlocked || maintenanceOn
    if (!lockScroll) return

    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [ready, geoBlocked, ipBlocked, maintenanceOn])

  if (!ready) {
    return <GateLoading />
  }

  if (geoBlocked) {
    const country = (data?.geo_country ?? '').trim().toUpperCase()
    const countryName = (data?.geo_country_name ?? '').trim()
    return (
      <div className="relative min-h-dvh overflow-hidden">
        <GateBlurBackdrop />
        <div className="relative z-10">
          <RegionRestrictedScreen countryCode={country} countryName={countryName} supportEmail={SUPPORT_EMAIL} />
        </div>
      </div>
    )
  }

  if (ipBlocked) {
    return (
      <div className="relative min-h-dvh overflow-hidden">
        <GateBlurBackdrop />
        <div className="relative z-10">
          <IpRestrictedScreen supportEmail={SUPPORT_EMAIL} />
        </div>
      </div>
    )
  }

  if (maintenanceOn) {
    return (
      <MaintenanceScreen
        maintenanceUntil={data?.maintenance_until ?? null}
        supportEmail={SUPPORT_EMAIL}
        envMaintenanceLock={Boolean(data?.maintenance_mode_env)}
      />
    )
  }

  return children
}
