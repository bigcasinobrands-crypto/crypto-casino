import { useCallback, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { RewardsLayout } from '../components/rewards/RewardsLayout'
import { useRewardsHub } from '../hooks/useRewardsHub'
import { usePlayerAuth } from '../playerAuth'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'

export default function RewardsPage() {
  const { accessToken, me, apiFetch } = usePlayerAuth()
  const { data, loading, err, reload } = useRewardsHub()
  const [claimBusy, setClaimBusy] = useState<string | null>(null)

  const displayName = me?.username || me?.email?.split('@')[0] || 'Player'

  const claimDay = useCallback(
    async (date: string) => {
      setClaimBusy(date)
      try {
        const res = await apiFetch('/v1/rewards/daily/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date }),
        })
        if (!res.ok) {
          const apiErr = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          toastPlayerApiError(apiErr, res.status, 'POST /v1/rewards/daily/claim', rid)
          return
        }
        void reload()
      } catch {
        toastPlayerNetworkError('Network error.', 'POST /v1/rewards/daily/claim')
      } finally {
        setClaimBusy(null)
      }
    },
    [apiFetch, reload],
  )

  if (!accessToken) return <Navigate to="/casino/games?auth=login" replace />

  return (
    <RewardsLayout
      displayName={displayName}
      data={data}
      loading={loading}
      err={err}
      onRetry={() => void reload()}
      claimBusy={claimBusy}
      onClaimDay={claimDay}
      subNav={
        <span className="text-casino-muted">
          Staging layout with test data:{' '}
          <Link to="/rewards/preview" className="font-semibold text-casino-primary underline">
            Open rewards preview (demo)
          </Link>
        </span>
      }
    />
  )
}
