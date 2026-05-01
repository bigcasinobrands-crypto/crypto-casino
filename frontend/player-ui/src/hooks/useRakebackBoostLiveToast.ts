import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { RewardsHubPayload } from './useRewardsHub'

/**
 * Toast when rakeback boost transitions to live (claim window open or boost running).
 * Skips the first hub payload after login so we don’t toast on every page load when already live.
 */
export function useRakebackBoostLiveToast(hub: RewardsHubPayload | null, isAuthenticated: boolean) {
  const navigate = useNavigate()
  const hydrated = useRef(false)
  const prevLive = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      hydrated.current = false
      prevLive.current = false
      return
    }
    if (!hub) return

    const rb = hub.vip?.rakeback_boost
    const live = rb?.enabled === true && (rb.claimable_now === true || rb.active_now === true)

    if (!hydrated.current) {
      hydrated.current = true
      prevLive.current = live
      return
    }

    if (live && !prevLive.current) {
      toast.info('Rakeback boost is live', {
        description: rb?.active_now
          ? 'Your boosted rakeback window is active.'
          : 'Your claim window is open on the VIP page.',
        action: {
          label: 'Open VIP',
          onClick: () => navigate('/vip'),
        },
      })
    }
    prevLive.current = live
  }, [hub, isAuthenticated, navigate])
}
