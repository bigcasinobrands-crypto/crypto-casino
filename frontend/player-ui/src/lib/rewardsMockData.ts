import type { RewardsHubPayload } from '../hooks/useRewardsHub'

function utcToday(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Rich demo payload for `/rewards/preview` — mirrors GET /v1/rewards/hub shape. */
export function buildMockRewardsHub(): RewardsHubPayload {
  const today = utcToday()
  const calendar = []
  for (let i = -3; i <= 3; i++) {
    const d = addDays(today, i)
    const ds = isoDate(d)
    const unlock = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0))
    let state: 'claimable' | 'locked' | 'claimed' = 'locked'
    if (i < 0) state = 'claimed'
    else if (i === 0) state = 'claimable'
    calendar.push({
      date: ds,
      state,
      amount_minor: i === 0 ? 250 : 100,
      unlock_at: unlock.toISOString(),
    })
  }

  return {
    calendar,
    hunt: {
      wager_accrued_minor: 12_450,
      next_threshold_wager_minor: 25_000,
      next_reward_minor: 50,
      last_threshold_index: 0,
    },
    vip: {
      tier: 'Goldfish II',
      points: 128_000,
      next_tier: 'Shark I',
      progress: {
        lifetime_wager_minor: 48_750_00,
        next_tier_min_wager_minor: 250_000_00,
        remaining_wager_minor: 201_250_00,
      },
    },
    aggregates: {
      bonus_locked_minor: 45_00,
      wagering_remaining_minor: 1_200_00,
      lifetime_promo_minor: 890_00,
    },
    available_offers: [
      {
        promotion_version_id: 101,
        title: 'Weekend reload 25%',
        description: '25% match up to $200 on your next deposit Fri–Sun.',
        kind: 'auto_on_deposit',
        schedule_summary: 'Fri 00:00 UTC – Sun 23:59 UTC',
        trigger_type: 'deposit',
        bonus_type: 'reload_deposit',
        valid_from: addDays(today, -1).toISOString(),
        valid_to: addDays(today, 5).toISOString(),
      },
      {
        promotion_version_id: 102,
        title: 'Monthly cashback',
        description: '10% net loss cashback credited weekly.',
        kind: 'auto_on_deposit',
        schedule_summary: 'Active',
        trigger_type: 'deposit',
        bonus_type: 'cashback_net_loss',
      },
      {
        promotion_version_id: 103,
        title: 'Welcome package',
        description: '100% first deposit match + free spins.',
        kind: 'auto_on_deposit',
        bonus_type: 'deposit_match',
      },
    ],
    bonus_instances: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        promotion_version_id: 103,
        status: 'active',
        granted_amount_minor: 100_00,
        currency: 'USDT',
        wr_required_minor: 3_000_00,
        wr_contributed_minor: 850_00,
        title: 'Welcome 100% match',
        bonus_type: 'deposit_match',
        created_at: addDays(today, -5).toISOString(),
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        promotion_version_id: 104,
        status: 'active',
        granted_amount_minor: 25_00,
        currency: 'USDT',
        wr_required_minor: 750_00,
        wr_contributed_minor: 100_00,
        title: 'Daily reward',
        bonus_type: 'no_deposit',
        created_at: today.toISOString(),
      },
    ],
  }
}
