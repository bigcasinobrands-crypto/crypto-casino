import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { MyBonusesLayout } from '../components/rewards/MyBonusesLayout'
import { useSharedOperationalHealth } from '../context/OperationalHealthContext'
import type { HubOffer } from '../hooks/useRewardsHub'
import { useRewardsHub } from '../hooks/useRewardsHub'
import { operationalBonusesEnabled } from '../lib/operationalPaymentGate'
import { usePlayerAuth } from '../playerAuth'

const STAGED_HUB_KEY = 'rewards:hub:staged-claim-v1'

function readStagedClaimFromSession(): HubOffer | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STAGED_HUB_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as HubOffer
    if (o && typeof o.promotion_version_id === 'number') return o
  } catch {
    /* ignore */
  }
  return null
}

function clearStagedClaimFromSession() {
  try {
    sessionStorage.removeItem(STAGED_HUB_KEY)
  } catch {
    /* ignore */
  }
}

function writeStagedClaimToSession(offer: HubOffer) {
  try {
    sessionStorage.setItem(STAGED_HUB_KEY, JSON.stringify(offer))
  } catch {
    /* ignore */
  }
}

export default function BonusesPage() {
  const { isAuthenticated } = usePlayerAuth()
  const { data: opHealth } = useSharedOperationalHealth()
  const bonusesEnabled = operationalBonusesEnabled(opHealth)
  const { data, loading, err, reload } = useRewardsHub()
  const [stagedAfterClaim, setStagedAfterClaim] = useState<HubOffer | null>(readStagedClaimFromSession)

  const setStagedPersisted = useCallback((offer: HubOffer | null) => {
    setStagedAfterClaim(offer)
    if (offer) writeStagedClaimToSession(offer)
    else clearStagedClaimFromSession()
  }, [])

  useEffect(() => {
    if (!stagedAfterClaim || !data) return
    const rows = data.bonus_instances
    if (!Array.isArray(rows)) return
    const pvid = stagedAfterClaim.promotion_version_id
    const has = rows.some((b) => b?.promotion_version_id === pvid)
    if (has) setStagedPersisted(null)
  }, [data, stagedAfterClaim, setStagedPersisted])

  if (!isAuthenticated) return <Navigate to="/casino/games?auth=login" replace />

  return (
    <MyBonusesLayout
      bonusesEnabled={bonusesEnabled}
      data={data}
      loading={loading}
      err={err}
      onRetry={() => void reload()}
      onBonusForfeited={(pvid) => {
        if (pvid != null) {
          setStagedAfterClaim((s) => {
            if (s?.promotion_version_id === pvid) {
              clearStagedClaimFromSession()
              return null
            }
            return s
          })
        }
        void reload()
      }}
      stagedAfterClaim={stagedAfterClaim}
      onHubUpdated={async (offer) => {
        if (offer == null) {
          setStagedPersisted(null)
          await reload()
          return
        }
        setStagedPersisted(offer)
        await reload()
      }}
    />
  )
}
