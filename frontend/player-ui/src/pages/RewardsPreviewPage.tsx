import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { RewardsLayout } from '../components/rewards/RewardsLayout'
import { buildMockRewardsHub } from '../lib/rewardsMockData'

/**
 * Public layout demo with static data — use for design QA and staff training.
 * Does not call the API; Claim shows a toast only.
 */
export default function RewardsPreviewPage() {
  const data = useMemo(() => buildMockRewardsHub(), [])
  const [claimBusy, setClaimBusy] = useState<string | null>(null)

  const onClaimDay = useCallback((date: string) => {
    setClaimBusy(date)
    toast.message('Preview only', {
      description: `Claim for ${date} is not executed here. Sign in on /rewards to use the real calendar.`,
    })
    window.setTimeout(() => setClaimBusy(null), 600)
  }, [])

  return (
    <RewardsLayout
      displayName="demo_player_01"
      data={data}
      loading={false}
      err={null}
      claimBusy={claimBusy}
      onClaimDay={onClaimDay}
      previewMode
      topBanner={
        <div className="mb-4 rounded-casino-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <strong className="font-extrabold">Layout preview</strong> — demo numbers and offers. Players see live data on{' '}
          <Link to="/rewards" className="font-semibold text-casino-primary underline">
            /rewards
          </Link>{' '}
          when signed in.
        </div>
      }
      subNav={
        <span className="text-casino-muted">
          <Link to="/casino/games" className="text-casino-primary underline">
            ← Back to games
          </Link>
        </span>
      }
    />
  )
}
