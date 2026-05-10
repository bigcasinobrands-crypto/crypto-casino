import { useCallback, useEffect, useId, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { readApiError } from '../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { usePlayerAuth } from '../playerAuth'
import { IconX } from './icons'

type Props = {
  open: boolean
  onDismiss: () => void
}

/** Blocks background interaction until dismissed; resend uses authenticated `/v1/auth/verify-email/resend`. */
export const EmailVerificationPromptModal: FC<Props> = ({ open, onDismiss }) => {
  const { t } = useTranslation()
  const titleId = useId()
  const descId = useId()
  const { apiFetch, me } = usePlayerAuth()
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMsg, setResendMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setResendMsg(null)
      setResendBusy(false)
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  const resend = useCallback(async () => {
    if (resendBusy) return
    setResendBusy(true)
    setResendMsg(null)
    try {
      const res = await apiFetch('/v1/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const p = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(p, res.status, 'POST /v1/auth/verify-email/resend', rid)
        setResendBusy(false)
        return
      }
      setResendMsg(t('profile.resendCheckInbox'))
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/auth/verify-email/resend')
    } finally {
      setResendBusy(false)
    }
  }, [apiFetch, resendBusy, t])

  if (!open || typeof document === 'undefined') return null

  const email = typeof me?.email === 'string' ? me.email.trim() : ''

  return createPortal(
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-end justify-center px-4 sm:items-center sm:p-4`}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/72 backdrop-blur-sm"
        aria-label={t('auth.close')}
        onClick={onDismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.06] bg-[#131116] shadow-[0_32px_64px_rgba(0,0,0,0.6)] max-sm:mb-[calc(var(--casino-mobile-nav-offset)+0.75rem)] max-sm:max-h-[calc(100dvh-var(--casino-mobile-nav-offset)-1.75rem)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 pb-4 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-white">
              {t('emailVerifyPrompt.title')}
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.06] text-casino-muted transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white"
            onClick={onDismiss}
            aria-label={t('auth.close')}
          >
            <IconX size={16} aria-hidden />
          </button>
        </div>

        <div id={descId} className="space-y-4 px-5 py-5 sm:px-6">
          <p className="text-sm leading-relaxed text-casino-muted">
            {t('emailVerifyPrompt.intro', { email: email || '—' })}
          </p>
          <p className="text-sm leading-relaxed text-casino-muted">{t('profile.verification.nonBlockingHint')}</p>

          {resendMsg ? (
            <p className="text-xs text-casino-muted">{resendMsg}</p>
          ) : null}

          <div className="flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              disabled={resendBusy}
              className="w-full rounded-xl bg-casino-primary py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 disabled:opacity-50"
              onClick={() => void resend()}
            >
              {resendBusy ? t('emailVerifyPrompt.sending') : t('emailVerifyPrompt.resend')}
            </button>
            <Link
              to="/profile?settings=verify"
              className="block w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 text-center text-sm font-semibold text-white/95 transition hover:bg-white/[0.06]"
              onClick={onDismiss}
            >
              {t('emailVerifyPrompt.settingsLink')}
            </Link>
            <button
              type="button"
              className="w-full py-2.5 text-sm font-medium text-casino-primary underline-offset-2 hover:underline"
              onClick={onDismiss}
            >
              {t('emailVerifyPrompt.continue')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
