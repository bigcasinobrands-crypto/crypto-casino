/**
 * Boilerplate Rules / Terms for casino challenges. Editors can tweak after “Generate”.
 * Terms copy references the player site Terms page (see getPlayerTermsPageUrl).
 */

export type ChallengeRulesTermsGenContext = {
  challengeType: 'multiplier' | 'wager_volume'
  targetMult: number
  targetWagerUsd: string
  minBetUsd: string
  maxWinners: string
  gameNote: string
  /** Display label for payout rail / prize (e.g. USDC · ERC20). */
  payLabel: string
  prizeCurrency: string
  /** Full sentence when VIP-only; omit or empty when all players. */
  vipEligibilityLine?: string
}

/** Absolute URL to the player app Terms of Service route (`/terms`). */
export function getPlayerTermsPageUrl(): string {
  const env =
    (import.meta.env.VITE_PLAYER_UI_ORIGIN as string | undefined)?.trim() ||
    (import.meta.env.VITE_PLAYER_APP_ORIGIN as string | undefined)?.trim()
  const base = env ? env.replace(/\/$/, '') : 'http://127.0.0.1:5174'
  return `${base}/terms`
}

export function generateChallengeRules(ctx: ChallengeRulesTermsGenContext): string {
  const min = ctx.minBetUsd.trim() || '0'
  const mw = ctx.maxWinners.trim() || '1'
  const lines: string[] = []

  lines.push('Qualifying play')
  if (ctx.challengeType === 'multiplier') {
    lines.push(
      `- Achieve at least ${ctx.targetMult}× on a single winning round on ${ctx.gameNote}.`,
    )
  } else {
    const w = ctx.targetWagerUsd.trim() || '0'
    lines.push(
      `- Wager a combined total of $${w} (qualifying stakes) on ${ctx.gameNote} during the challenge window.`,
    )
  }
  lines.push(`- Minimum bet per qualifying round: $${min}.`)
  lines.push('- Only settled, non-void rounds count toward progress.')
  lines.push(
    `- Up to ${mw} winner(s); ranking or tie-break defaults to best progress toward the goal unless the lobby states otherwise.`,
  )
  lines.push('')
  lines.push('Eligibility & enforcement')
  lines.push('- One entry per player for this challenge unless the operator states otherwise.')
  lines.push('- Staff may disqualify abuse, collusion, bonus or jurisdictional violations, or play outside house rules.')
  const vip = ctx.vipEligibilityLine?.trim()
  if (vip) lines.push(`- ${vip}`)

  return lines.join('\n')
}

export function generateChallengeTerms(
  playerTermsUrl: string,
  ctx: ChallengeRulesTermsGenContext,
): string {
  const pay = ctx.payLabel.trim() || ctx.prizeCurrency.trim() || 'the configured payout asset'
  const termsLink = playerTermsUrl.trim() || getPlayerTermsPageUrl()
  return [
    `By entering, you confirm you have read and agree to our Terms & Conditions (${termsLink}), including responsible gambling and account-limit policies.`,
    `Cash prizes are settled in ${pay} (or ledger-equivalent per your wallet) after validation; some payouts may require manual review.`,
    'If the challenge or prize type includes bonus credit, casino bonus terms and wagering rules also apply where relevant.',
    'We may modify, suspend, or cancel this challenge where required for compliance, fairness, or operations.',
  ].join('\n')
}
