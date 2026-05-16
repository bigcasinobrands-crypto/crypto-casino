import type { TFunction } from 'i18next'

import type { ApiErr } from '../api/errors'
import { formatApiError } from '../api/errors'
import i18n from '../i18n'

/** Safe demo/provider wording shared by casino lobby + sportsbook. */
export function bogPlayerSafeBody(apiMsg: string, t: TFunction): string {
  const fb = apiMsg.trim()
  if (/invalid\s+user\s+details/i.test(fb)) {
    return fb
  }
  if (
    /demo\s+game\s+not\s+available|not\s+available\s+at\s+this\s+moment/i.test(fb) ||
    (/demo/i.test(fb) && /not\s+available/i.test(fb))
  ) {
    return t('gameLobby.error.providerRefusedFreePlay')
  }
  return t('errors.bog_error')
}

export type ResolvedPlayerApiToast = {
  title: string
  description?: string
}

export function playerErrorDebugEnabled(): boolean {
  return (
    import.meta.env.DEV ||
    String(import.meta.env.VITE_PLAYER_DEBUG_ERRORS || '').toLowerCase() === 'true' ||
    String(import.meta.env.VITE_PLAYER_DEBUG_ERRORS || '') === '1'
  )
}

export function formatPlayerErrorDebugFooter(
  parsed: ApiErr | null,
  status: number,
  source: string,
  requestId?: string | null,
): string {
  const code = parsed?.code?.trim() || (status ? `HTTP_${status}` : 'HTTP_ERROR')
  const lines = [`Code: ${code}`, `HTTP ${status}`, `Source: ${source}`]
  if (requestId?.trim()) lines.push(`Request: ${requestId.trim()}`)
  return lines.join('\n')
}

/**
 * Lobby / sports launch overlays — unknown codes still show API fallback (backend should sanitize).
 */
export function resolveLaunchBodyMessage(
  code: string | undefined,
  fallback: string,
  t: TFunction,
  launchContext: 'casino' | 'sportsbook' = 'casino',
): string {
  switch (code) {
    case 'maintenance':
      return t('gameLobby.error.maintenance')
    case 'launch_disabled':
      return t('gameLobby.error.launch_disabled')
    case 'geo_blocked':
      return t('gameLobby.error.geo_blocked')
    case 'ip_blocked':
      return t('gameLobby.error.ip_blocked')
    case 'self_excluded':
      return t('gameLobby.error.self_excluded')
    case 'account_closed':
      return t('gameLobby.error.account_closed')
    case 'bog_unconfigured':
      return launchContext === 'sportsbook'
        ? t('errors.sportsbook_unconfigured')
        : t('gameLobby.error.bog_unconfigured')
    case 'bog_error':
      return bogPlayerSafeBody(fallback, t)
    case 'demo_unavailable':
      return t('gameLobby.error.demo_unavailable')
    case 'not_found':
      return launchContext === 'sportsbook' ? t('errors.sportsbook_not_in_catalog') : t('gameLobby.error.not_found')
    case 'unauthorized':
      return t('gameLobby.error.unauthorized')
    case 'sportsbook_unconfigured':
      return t('errors.sportsbook_unconfigured')
    default:
      return fallback
  }
}

/**
 * Bottom-right API error toasts — never surface raw codes/paths; unknown codes → generic copy.
 */
export function resolvePlayerApiToastCopy(
  parsed: ApiErr | null,
  _status: number,
  fallbackFromCaller: string,
  t: TFunction = i18n.t.bind(i18n),
): ResolvedPlayerApiToast {
  const fb = fallbackFromCaller.trim() || t('errors.genericBody')

  if (!parsed) {
    return {
      title: t('errors.genericTitle'),
      description: t('errors.genericBody'),
    }
  }

  const code = parsed.code.trim()
  const apiMsg = formatApiError(parsed, fb)

  switch (code) {
    case 'maintenance':
      return { title: t('gameLobby.error.maintenance') }
    case 'launch_disabled':
      return { title: t('gameLobby.error.launch_disabled') }
    case 'geo_blocked':
      return { title: t('gameLobby.error.geo_blocked') }
    case 'ip_blocked':
      return { title: t('gameLobby.error.ip_blocked') }
    case 'self_excluded':
      return { title: t('gameLobby.error.self_excluded') }
    case 'account_closed':
      return { title: t('gameLobby.error.account_closed') }
    case 'bog_unconfigured':
      return { title: t('gameLobby.error.bog_unconfigured') }
    case 'bog_error':
      return { title: bogPlayerSafeBody(apiMsg, t) }
    case 'demo_unavailable':
      return { title: t('gameLobby.error.demo_unavailable') }
    case 'not_found':
      return { title: t('errors.not_found') }
    case 'unauthorized':
      return { title: t('gameLobby.error.unauthorized') }
    case 'sportsbook_unconfigured':
      return { title: t('errors.sportsbook_unconfigured') }
    case 'http_error':
      return { title: t('errors.http_error') }
    case 'invalid_credentials':
      return { title: t('errors.invalid_credentials') }
    case 'wrong_password':
      return { title: t('errors.wrong_password') }
    case 'invalid_refresh':
    case 'invalid_token':
      return { title: t('errors.session_expired') }
    case 'terms_required':
      return { title: t('errors.terms_required') }
    case 'already_entered':
      return { title: t('errors.already_entered') }
    case 'vip_tier_required':
      return { title: t('errors.vip_tier_required') }
    case 'not_enterable':
      return { title: t('errors.not_enterable') }
    case 'enter_failed':
      return { title: t('errors.challenge_enter_failed') }
    case 'claim_failed':
      return { title: t('errors.challenge_claim_failed') }
    case 'server_error':
      return { title: t('errors.server_error') }
    case 'csrf_failed':
      return { title: t('errors.csrf_failed') }
    case 'conflict':
      return { title: t('errors.conflict') }
    case 'provider_error':
      return { title: t('errors.provider_error') }
    case 'ledger_settle_failed':
      return { title: t('errors.ledger_settle_failed') }
    case 'weak_password':
      return { title: t('errors.weak_password') }
    case 'password_breached':
      return { title: t('errors.password_breached') }
    case 'username_taken':
      return { title: t('errors.username_taken') }
    case 'invalid_username':
      return { title: t('errors.invalid_username') }
    case 'email_already_registered':
      return { title: t('errors.email_already_registered') }
    case 'captcha_failed':
      return { title: t('errors.captcha_failed') }
    case 'email_mfa_unavailable':
      return { title: t('errors.email_mfa_unavailable') }
    case 'fingerprint_required':
      return { title: t('errors.fingerprint_required') }
    default:
      return {
        title: t('errors.genericTitle'),
        description: t('errors.genericBody'),
      }
  }
}

export function resolvePlayerNetworkToastCopy(message: string, t: TFunction = i18n.t.bind(i18n)): ResolvedPlayerApiToast {
  const body = message.trim() || t('errors.networkBody')
  return {
    title: t('errors.networkTitle'),
    description: body,
  }
}

export function resolvePlayerClientToastCopy(
  _internalCode: string,
  message: string,
  detail: string | undefined,
  t: TFunction = i18n.t.bind(i18n),
): ResolvedPlayerApiToast {
  const descParts = [message.trim() || t('errors.client_fallback')]
  if (playerErrorDebugEnabled() && detail?.trim()) descParts.push(detail.trim())
  return {
    title: t('errors.client_title'),
    description: descParts.join('\n'),
  }
}
