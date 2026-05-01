/**
 * Deterministic demo payloads for the admin dashboard when the API has no / little data.
 *
 * - `VITE_ADMIN_DUMMY_DASHBOARD=true` / `1` — force demo (e.g. production preview).
 * - `VITE_ADMIN_DUMMY_DASHBOARD=false` / `0` — force live `/v1` dashboard calls.
 * - Unset — while running `vite` dev (`import.meta.env.DEV`), demo is on by default so a
 *   missing or erroring API does not blank the dashboard.
 */

export function isDashboardDummyMode(): boolean {
  const v = import.meta.env.VITE_ADMIN_DUMMY_DASHBOARD
  if (v === 'false' || v === '0') return false
  if (v === 'true' || v === '1') return true
  return import.meta.env.DEV === true
}

function periodDays(period: string): number {
  if (period === '7d') return 7
  if (period === '90d') return 90
  return 30
}

/** UTC YYYY-MM-DD for the last `days` days inclusive of today. */
function dayStamps(days: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function buildDummyCharts(period: string) {
  const days = periodDays(period)
  const dates = dayStamps(days)

  const deposits_by_day = dates.map((date, i) => {
    const wave = 1.2 + 0.35 * Math.sin(i / 4)
    const total_minor = Math.round(2_800_000 * wave + i * 45_000)
    return { date, total_minor, count: 8 + (i % 6) + Math.floor(i / 5) }
  })

  const withdrawals_by_day = dates.map((date, i) => {
    const wave = 0.55 + 0.2 * Math.cos(i / 3)
    const total_minor = Math.round(1_100_000 * wave + i * 18_000)
    return { date, total_minor, count: 3 + (i % 4) }
  })

  const ggr_by_day = dates.map((date, i) => {
    const bets = Math.round(6_500_000 + i * 120_000 + (i % 5) * 80_000)
    const wins = Math.round(bets * (0.94 + 0.02 * Math.sin(i / 5)))
    return { date, bets_minor: bets, wins_minor: wins, ggr_minor: bets - wins }
  })

  const registrations_by_day = dates.map((date, i) => ({
    date,
    count: 2 + (i % 5) + (i % 11 === 0 ? 8 : 0),
  }))

  const game_launches_by_day = dates.map((date, i) => ({
    date,
    total_minor: 0,
    count: 180 + i * 12 + (i % 7) * 40,
  }))

  const bonus_grants_by_day = dates.map((date, i) => ({
    date,
    total_minor: Math.round(120_000 + i * 6_500 + (i % 4) * 25_000),
    count: 4 + (i % 3),
  }))

  return {
    deposits_by_day,
    withdrawals_by_day,
    ggr_by_day,
    registrations_by_day,
    game_launches_by_day,
    bonus_grants_by_day,
  }
}

export function dummyKPIs() {
  return {
    ggr_24h: 185_000_00,
    ggr_7d: 1_240_000_00,
    ggr_30d: 4_850_000_00,
    ggr_all: 42_000_000_00,
    deposits_24h: 620_000_00,
    deposits_7d: 4_100_000_00,
    deposits_30d: 16_200_000_00,
    deposits_count_24h: 42,
    deposits_count_7d: 310,
    deposits_count_30d: 1180,
    withdrawals_24h: 210_000_00,
    withdrawals_7d: 1_380_000_00,
    withdrawals_30d: 5_400_000_00,
    withdrawals_count_24h: 18,
    withdrawals_count_7d: 95,
    withdrawals_count_30d: 360,
    net_cash_flow_30d: 10_800_000_00,
    active_players_24h: 420,
    active_players_7d: 2180,
    active_players_30d: 6420,
    new_registrations_24h: 28,
    new_registrations_7d: 190,
    new_registrations_30d: 720,
    bonus_cost_24h: 45_000_00,
    bonus_cost_7d: 310_000_00,
    bonus_cost_30d: 1_180_000_00,
    ngr_30d: 3_670_000_00,
    arpu_7d: 568_92,
    avg_deposit_size_30d: 1_372_881,
    deposit_conversion_rate: 34.5,
    pending_withdrawals_value: 890_000_00,
    pending_withdrawals_count: 14,
  }
}

export function dummyTopGames() {
  const titles = [
    'Sweet Bonanza',
    'Gates of Olympus',
    'Big Bass Bonanza',
    'Book of Dead',
    'Sugar Rush',
    'The Dog House',
    'Wanted Dead or a Wild',
    'Reactoonz',
    'Starburst',
    'Legacy of Dead',
  ]
  const top_by_launches = titles.map((title, i) => ({
    game_id: `demo-game-${i + 1}`,
    title,
    provider_key: i % 2 === 0 ? 'Pragmatic' : 'PlaynGO',
    launch_count: 5200 - i * 420,
    bets_minor: 5_000_000 - i * 100_000,
    wins_minor: 4_700_000 - i * 95_000,
    ggr_minor: 180_000_00 - i * 12_000_00,
    rtp_pct: 96.2 - i * 0.15,
  }))
  const top_by_ggr = [...top_by_launches]
    .sort((a, b) => (b.ggr_minor ?? 0) - (a.ggr_minor ?? 0))
    .slice(0, 10)
  return { top_by_launches, top_by_ggr }
}

export function dummyPlayerStats() {
  const trend = dayStamps(7).map((date, i) => ({ date, count: 5 + i * 2 }))
  return {
    total_registered: 18_420,
    total_with_deposit: 12_100,
    total_active_7d: 2380,
    total_active_30d: 6890,
    deposit_conversion_rate: 38.2,
    avg_ltv_minor: 420_000_00,
    top_depositors: [
      { id: '11111111-1111-1111-1111-111111111101', email: 'highroller@example.com', total_minor: 2_400_000_00 },
      { id: '11111111-1111-1111-1111-111111111102', email: 'vip.player@example.com', total_minor: 1_120_000_00 },
      { id: '11111111-1111-1111-1111-111111111103', email: 'regular@example.com', total_minor: 640_000_00 },
      { id: '11111111-1111-1111-1111-111111111104', email: 'weekend@example.com', total_minor: 410_000_00 },
      { id: '11111111-1111-1111-1111-111111111105', email: 'slotsfan@example.com', total_minor: 298_000_00 },
    ],
    registrations_trend: trend,
  }
}

export function dummyBonusStats() {
  return {
    promotions_non_archived: 24,
    active_bonus_instances: 1180,
    grants_last_24h: 86,
    risk_queue_pending: 3,
    total_bonus_cost_30d: 1_180_000_00,
    wr_completion_rate: 42.5,
    forfeiture_rate: 8.1,
    avg_grant_amount_minor: 45_000_00,
    bonus_pct_of_ggr: 12.4,
  }
}

export function dummyDashboardSystem() {
  return {
    webhook_deliveries_pending: 2,
    users_missing_fystack_wallet: 5,
    withdrawals_in_flight: 4,
    worker_failed_jobs_unresolved: 0,
    bonus_outbox_pending_delivery: 1,
    bonus_outbox_dead_letter: 0,
    redis_queue_depth: 3,
    process_metrics: {
      bonus_grants_total: 1288,
      bonus_eval_errors: 2,
      bonus_bet_rejects: 45,
      bonus_outbox_delivered_total: 980,
      bonus_outbox_delivery_attempt_failed_total: 12,
      bonus_outbox_dlq_total: 1,
      bonus_outbox_redriven_total: 1,
      bonus_max_bet_violation_forfeits_total: 3,
      jobs_processed_total: 15420,
      jobs_failed_total: 6,
    },
  }
}
