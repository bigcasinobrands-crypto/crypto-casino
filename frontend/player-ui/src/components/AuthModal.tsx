import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { useAuthModal, type AuthPanel } from '../authModalContext'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { useSiteContent } from '../hooks/useSiteContent'
import { usePlayerAuth } from '../playerAuth'
import { ForgotPasswordForm, LoginForm, RegisterForm } from './AuthForms'
import { IconShieldCheck } from './icons'

const REMEMBER_KEY = 'player_remember_login_id'

const panelCopy: Record<AuthPanel, { kicker: string; title: string; subtitle: string }> = {
  login: {
    kicker: 'Welcome back',
    title: 'Sign in',
    subtitle: 'Use your email and password to continue.',
  },
  register: {
    kicker: 'Create your account',
    title: 'Register',
    subtitle: 'Use your email and a strong password (12+ characters).',
  },
  forgot: {
    kicker: 'Account help',
    title: 'Reset password',
    subtitle: "We'll email a reset link if that address has an account.",
  },
}

export function AuthModal() {
  const { panel, closeAuth, setPanel } = useAuthModal()
  const { isAuthenticated } = usePlayerAuth()
  const { getContent } = useSiteContent()
  const siteLabel = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    if (isAuthenticated && panel) closeAuth()
  }, [isAuthenticated, panel, closeAuth])

  useEffect(() => {
    if (!panel) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [panel])

  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuth()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, closeAuth])

  if (!panel) return null

  const copy = panelCopy[panel]

  return createPortal(
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-center justify-center p-2.5 sm:p-5`}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Close"
        onClick={closeAuth}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={copy.subtitle ? descId : undefined}
        className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-[min(100%,380px)] flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth rounded-casino-lg border border-casino-border/30 bg-casino-surface p-4 text-casino-foreground shadow-[0_18px_40px_rgba(0,0,0,0.28)] sm:max-h-[calc(100dvh-1.5rem)] sm:max-w-[420px] sm:gap-3 sm:p-5 scrollbar-casino"
      >
        <button
          type="button"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-casino-md text-sm text-casino-muted transition hover:bg-casino-elevated hover:text-casino-foreground sm:right-3 sm:top-3 sm:h-8 sm:w-8 sm:text-base"
          onClick={closeAuth}
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex justify-center pr-6 pt-0 sm:pr-7">
          <span className="text-[15px] font-black tracking-tight text-white sm:text-lg">{siteLabel}</span>
        </div>

        <div className="flex flex-col items-center gap-0.5 pr-6 text-center sm:gap-1 sm:pr-7">
          <div className="inline-flex items-center gap-1 rounded-full bg-casino-elevated px-1.5 py-0.5 text-[9px] font-semibold text-casino-muted sm:gap-1.5 sm:px-2 sm:py-1 sm:text-[10px]">
            <IconShieldCheck size={11} className="text-casino-primary" aria-hidden />
            <span>{copy.kicker}</span>
          </div>
          <h2
            id={titleId}
            className="text-lg font-bold leading-tight tracking-tight text-casino-foreground sm:text-2xl"
          >
            {copy.title}
          </h2>
          <p id={descId} className="max-w-[280px] text-[11px] leading-snug text-casino-muted sm:max-w-[300px] sm:text-xs sm:leading-normal">
            {copy.subtitle}
          </p>
        </div>

        <div className="flex min-h-0 flex-col gap-1.5 sm:gap-2">
          {panel === 'login' && <LoginForm rememberStorageKey={REMEMBER_KEY} />}
          {panel === 'register' && <RegisterForm />}
          {panel === 'forgot' && <ForgotPasswordForm onBack={() => setPanel('login')} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}
