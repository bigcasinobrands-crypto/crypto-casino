/** Default `rules` payloads per bonus_type (matches engine / wizard templates). */

function depositTrigger(firstDepositOnly: boolean) {
  return {
    type: 'deposit' as const,
    min_minor: 1000,
    max_minor: 0,
    first_deposit_only: firstDepositOnly,
    nth_deposit: 0,
    channels: [] as string[],
  }
}

function defaultWagering() {
  return { multiplier: 35, max_bet_minor: 50000, game_weight_pct: 100 }
}

function defaultSegment() {
  return {
    vip_min_tier: 0,
    tags: [] as string[],
    country_allow: [] as string[],
    country_deny: [] as string[],
    explicit_targeting_only: false,
  }
}

export function defaultRulesForType(typeId: string): Record<string, unknown> {
  if (typeId === 'deposit_match') {
    return {
      trigger: depositTrigger(true),
      reward: { type: 'percent_match', percent: 100, cap_minor: 50000, fixed_minor: 0 },
      wagering: defaultWagering(),
      withdraw_policy: 'block',
      excluded_game_ids: [] as string[],
      allowed_game_ids: [] as string[],
      segment: defaultSegment(),
    }
  }
  if (typeId === 'reload_deposit') {
    return {
      trigger: depositTrigger(false),
      reward: { type: 'percent_match', percent: 100, cap_minor: 50000, fixed_minor: 0 },
      wagering: defaultWagering(),
      withdraw_policy: 'block',
      excluded_game_ids: [] as string[],
      allowed_game_ids: [] as string[],
      segment: defaultSegment(),
    }
  }
  if (typeId === 'free_spins_only') {
    return {
      trigger: depositTrigger(false),
      reward: {
        type: 'freespins',
        percent: 0,
        cap_minor: 0,
        fixed_minor: 0,
        rounds: 20,
        game_id: '',
        bet_per_round_minor: 1,
      },
      wagering: defaultWagering(),
      withdraw_policy: 'block',
      excluded_game_ids: [] as string[],
      allowed_game_ids: [] as string[],
      segment: defaultSegment(),
    }
  }
  if (typeId === 'composite_match_and_fs') {
    return {
      trigger: depositTrigger(false),
      reward: { type: 'percent_match', percent: 100, cap_minor: 100000, fixed_minor: 0 },
      free_spins: { rounds: 20, game_id: '', bet_per_round_minor: 1 },
      wagering: defaultWagering(),
      withdraw_policy: 'block',
      excluded_game_ids: [] as string[],
      allowed_game_ids: [] as string[],
      segment: defaultSegment(),
    }
  }
  if (typeId === 'cashback_net_loss') {
    return {
      trigger: {
        type: 'schedule',
        min_minor: 0,
        max_minor: 0,
        first_deposit_only: false,
        nth_deposit: 0,
        channels: [] as string[],
      },
      reward: { type: 'cashback', percent: 10, cap_minor: 200000, fixed_minor: 0 },
      wagering: { multiplier: 1, max_bet_minor: 0, game_weight_pct: 100 },
      withdraw_policy: 'default',
      excluded_game_ids: [] as string[],
      allowed_game_ids: [] as string[],
      segment: defaultSegment(),
    }
  }
  if (typeId === 'wager_rebate') {
    return {
      trigger: {
        type: 'schedule',
        min_minor: 0,
        max_minor: 0,
        first_deposit_only: false,
        nth_deposit: 0,
        channels: [] as string[],
      },
      reward: { type: 'percent_match', percent: 0, cap_minor: 0, fixed_minor: 0 },
      wagering: { multiplier: 1, max_bet_minor: 0, game_weight_pct: 100 },
      withdraw_policy: 'default',
      excluded_game_ids: [] as string[],
      allowed_game_ids: [] as string[],
      segment: defaultSegment(),
    }
  }
  if (typeId === 'no_deposit') {
    return {
      trigger: {
        type: 'manual',
        min_minor: 0,
        max_minor: 0,
        first_deposit_only: false,
        nth_deposit: 0,
        channels: [] as string[],
      },
      reward: { type: 'fixed', percent: 0, cap_minor: 0, fixed_minor: 500 },
      wagering: { multiplier: 40, max_bet_minor: 25000, game_weight_pct: 100 },
      withdraw_policy: 'block',
      excluded_game_ids: [] as string[],
      allowed_game_ids: [] as string[],
      segment: defaultSegment(),
    }
  }
  return {}
}

export function isDepositFamily(typeId: string) {
  return (
    typeId === 'deposit_match' ||
    typeId === 'reload_deposit' ||
    typeId === 'free_spins_only' ||
    typeId === 'composite_match_and_fs'
  )
}

export function isScheduleFamily(typeId: string) {
  return typeId === 'cashback_net_loss' || typeId === 'wager_rebate'
}
