/** Fields needed to compute player-hub visibility (catalog list or promotion detail). */
export type PlayerHubPromotionFlags = {
  status: string
  has_published_version: boolean
  grants_paused: boolean
  player_hub_force_visible?: boolean
  latest_published_valid_from?: string | null
}

export function isLiveForPlayerHub(p: PlayerHubPromotionFlags): boolean {
  return playerHubOperationalState(p) === 'live'
}

export function playerHubOperationalState(p: PlayerHubPromotionFlags): 'live' | 'scheduled' | 'paused' | 'archived' | 'draft' {
  if (p.status === 'archived') return 'archived'
  if (!p.has_published_version) return 'draft'
  if (p.grants_paused) return 'paused'
  if (p.player_hub_force_visible) return 'live'
  if (p.latest_published_valid_from) {
    const vf = new Date(p.latest_published_valid_from)
    if (!Number.isNaN(vf.getTime()) && vf.getTime() > Date.now()) return 'scheduled'
  }
  return 'live'
}

export function playerHubVisibilityBadge(p: PlayerHubPromotionFlags): {
  label: string
  className: string
  hint: string
} {
  const state = playerHubOperationalState(p)
  if (state === 'archived') {
    return {
      label: 'Archived',
      className: 'text-bg-secondary',
      hint: 'Not shown to players. Restore from catalog or detail page to edit.',
    }
  }
  if (state === 'draft') {
    return {
      label: 'Not published',
      className: 'text-bg-secondary',
      hint: 'No published version yet. Use Schedule & deliver, or the catalog Live switch.',
    }
  }
  if (state === 'paused') {
    return {
      label: 'Paused',
      className: 'text-bg-warning text-dark',
      hint: 'Published but grants are paused — hidden from new automated delivery.',
    }
  }
  if (state === 'scheduled') {
    return {
      label: 'Scheduled',
      className: 'text-bg-info text-dark',
      hint: 'Published and grants on, but starts in the future based on schedule.',
    }
  }
  return {
    label: 'Live',
    className: 'text-bg-success',
    hint: 'Published and grants on — qualifying players can see this on My Bonuses (rules/schedule apply).',
  }
}
