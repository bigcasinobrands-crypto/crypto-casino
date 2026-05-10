import type { FC, ReactNode } from 'react'
import { useSharedOperationalHealth } from '../../context/OperationalHealthContext'
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
  const { data, ready } = useSharedOperationalHealth()

  if (!ready) {
    return <GateLoading />
  }

  const geoBlocked = Boolean(data?.geo_blocked)
  if (geoBlocked) {
    const country = (data?.geo_country ?? '').trim().toUpperCase()
    const countryName = (data?.geo_country_name ?? '').trim()
    return (
      <div className="relative min-h-dvh">
        <GateBlurBackdrop />
        <div className="relative z-10">
          <RegionRestrictedScreen countryCode={country} countryName={countryName} supportEmail={SUPPORT_EMAIL} />
        </div>
      </div>
    )
  }

  const ipBlocked = Boolean(data?.ip_blocked)
  if (ipBlocked) {
    return <IpRestrictedScreen supportEmail={SUPPORT_EMAIL} />
  }

  if (data?.maintenance_mode) {
    return (
      <MaintenanceScreen
        maintenanceUntil={data.maintenance_until ?? null}
        supportEmail={SUPPORT_EMAIL}
        envMaintenanceLock={Boolean(data.maintenance_mode_env)}
      />
    )
  }

  return children
}
