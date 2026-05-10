import type { FC, ReactNode } from 'react'
import { useSharedOperationalHealth } from '../../context/OperationalHealthContext'
import { MaintenanceScreen } from './MaintenanceScreen'
import { RegionRestrictedScreen } from './RegionRestrictedScreen'

const SUPPORT_EMAIL =
  (import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL as string | undefined)?.trim() || 'support@vybebet.com'

function GateLoading() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0a0d] text-white"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
      <p className="mt-4 text-sm text-white/60">Loading…</p>
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
    return <RegionRestrictedScreen countryCode={country} supportEmail={SUPPORT_EMAIL} />
  }

  if (data?.maintenance_mode) {
    return <MaintenanceScreen maintenanceUntil={data.maintenance_until ?? null} supportEmail={SUPPORT_EMAIL} />
  }

  return children
}
