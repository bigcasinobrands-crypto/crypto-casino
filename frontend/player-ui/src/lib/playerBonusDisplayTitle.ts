/**
 * Player-visible bonus headings — hides E2E/QA internal promotion slugs when marketing copy exists.
 * Server responses are humanized in `bonus.HumanizeOfferTitle`; this mirrors that for cached/stale payloads.
 */

const INTERNAL_TITLE = /^(e2e|qa|test)[-_]sim([-_]|$)/i

const BONUS_TYPE_LABELS: Record<string, string> = {
  deposit_match: 'Deposit match',
  reload_deposit: 'Reload bonus',
  free_spins_only: 'Free spins only',
  composite_match_and_fs: 'Match + free spins',
  cashback_net_loss: 'Cashback (net loss)',
  wager_rebate: 'Wager / turnover rebate',
  no_deposit: 'No-deposit / registration',
  custom: 'Custom (advanced)',
}

function stripMarkdownBold(s: string): string {
  let t = s.trim()
  for (let i = 0; i < 4; i++) {
    const next = t.replace(/^\*\*|\*\*$/g, '').trim()
    if (next === t) break
    t = next
  }
  return t
}

function firstLineFromDescription(desc: string): string {
  let line = desc.split(/\r?\n/)[0] ?? ''
  line = line.replace(/^#+\s*/, '').trim()
  line = stripMarkdownBold(line)
  if (!line) return ''
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}

function humanizeBonusType(bt: string): string {
  if (BONUS_TYPE_LABELS[bt]) return BONUS_TYPE_LABELS[bt]
  return bt
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export type PlayerBonusTitleInput = {
  title?: string | null
  description?: string | null
  promotionVersionId?: number | null
  bonusType?: string | null
}

/** Default label when nothing else fits (matches offer cards). */
const DEFAULT_LABEL = 'Casino bonus'

export function playerBonusDisplayTitle(input: PlayerBonusTitleInput, emptyFallback = DEFAULT_LABEL): string {
  const raw = input.title?.trim() ?? ''
  const looksInternal = raw !== '' && INTERNAL_TITLE.test(raw)
  if (raw !== '' && !looksInternal) {
    return raw
  }

  const desc = input.description?.trim() ?? ''
  const fromDesc = desc ? firstLineFromDescription(desc) : ''
  if (fromDesc) {
    return fromDesc
  }

  const bt = input.bonusType?.trim() ?? ''
  if (bt) {
    return humanizeBonusType(bt)
  }

  const id = input.promotionVersionId
  if (id != null && id > 0) {
    return `Bonus offer #${id}`
  }

  return raw || emptyFallback
}
