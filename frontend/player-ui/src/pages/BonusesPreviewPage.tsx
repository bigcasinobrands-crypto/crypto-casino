import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MyBonusesLayout } from '../components/rewards/MyBonusesLayout'
import { buildMockRewardsHub } from '../lib/rewardsMockData'

export default function BonusesPreviewPage() {
  const data = useMemo(() => buildMockRewardsHub(), [])

  return (
    <MyBonusesLayout
      data={data}
      loading={false}
      err={null}
      subNav={
        <span className="text-casino-muted">
          Demo layout (no API calls).{' '}
          <Link to="/bonuses" className="font-semibold text-casino-primary underline">
            Open My Bonuses (signed in)
          </Link>
        </span>
      }
    />
  )
}
