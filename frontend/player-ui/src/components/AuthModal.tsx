import { useEffect, useId } from 'react'
import { useAuthModal, type AuthPanel } from '../authModalContext'
import { usePlayerAuth } from '../playerAuth'
import BrandLogo from './BrandLogo'
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
  const { accessToken } = usePlayerAuth()
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    if (accessToken && panel) closeAuth()
  }, [accessToken, panel, closeAuth])

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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#050408]/90 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={closeAuth}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={copy.subtitle ? descId : undefined}
        className="scrollbar-none relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[400px] flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-casino-lg border border-casino-border/30 bg-casino-surface p-5 text-casino-foreground shadow-[0_18px_40px_rgba(0,0,0,0.28)] sm:max-w-[420px]"
      >
        <button
          type="button"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-casino-md text-base text-casino-muted transition hover:bg-casino-elevated hover:text-casino-foreground"
          onClick={closeAuth}
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex justify-center pr-7 pt-0.5">
          <BrandLogo compact onNavigate={closeAuth} />
        </div>

        <div className="flex flex-col items-center gap-1 pr-7 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-casino-elevated px-2 py-1 text-[10px] font-semibold text-casino-muted">
            <IconShieldCheck size={12} className="text-casino-primary" aria-hidden />
            <span>{copy.kicker}</span>
          </div>
          <h2 id={titleId} className="text-xl font-bold leading-tight tracking-tight text-casino-foreground sm:text-2xl">
            {copy.title}
          </h2>
          <p id={descId} className="max-w-[300px] text-xs leading-normal text-casino-muted">
            {copy.subtitle}
          </p>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          {panel === 'login' && <LoginForm rememberStorageKey={REMEMBER_KEY} />}
          {panel === 'register' && <RegisterForm />}
          {panel === 'forgot' && <ForgotPasswordForm onBack={() => setPanel('login')} />}
        </div>
      </div>
    </div>
  )
}
