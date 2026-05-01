export type MyEntry = {
  status: string
  progress_value: number
  best_multiplier?: number
  total_wagered_minor?: number
  qualifying_bets?: number
  prize_awarded_minor?: number
  can_claim_prize?: boolean
}

export type PlayerChallengeListItem = {
  id: string
  slug: string
  title: string
  description: string
  challenge_type: string
  status: string
  min_bet_amount_minor: number
  prize_type: string
  prize_currency?: string
  max_winners?: number
  winners_so_far?: number
  prize_amount_minor?: number
  target_multiplier?: number
  target_wager_amount_minor?: number
  hero_image_url?: string
  badge_label?: string
  is_featured?: boolean
  vip_only?: boolean
  vip_tier_minimum?: string
  game_ids?: string[]
  require_claim_for_prize?: boolean
  prize_payout_asset_key?: string
  rules?: string
  terms?: string
  starts_at: string
  ends_at: string
  my_entry?: MyEntry
}
