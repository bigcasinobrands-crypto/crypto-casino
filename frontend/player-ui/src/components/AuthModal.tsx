import { useEffect, useId } from 'react'
import { useAuthModal, type AuthPanel } from '../authModalContext'
import { usePlayerAuth } from '../playerAuth'
import { ForgotPasswordForm, LoginForm, RegisterForm } from './AuthForms'

export function AuthModal() {
  const { panel, closeAuth, setPanel } = useAuthModal()
  const { accessToken } = usePlayerAuth()
  const titleId = useId()

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

  const titles: Record<AuthPanel, { title: string; subtitle: string }> = {
    login: {
      title: 'Login now',
      subtitle: 'Please log in to continue using the casino.',
    },
    register: {
      title: 'Sign up',
      subtitle: 'Register with email to create your account.',
    },
    forgot: {
      title: 'Reset password',
      subtitle: "We'll email you a link if an account exists.",
    },
  }
  const { title, subtitle } = titles[panel]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={closeAuth}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(92vh,640px)] w-full max-w-[420px] flex-col overflow-hidden rounded-t-[1.75rem] shadow-2xl sm:rounded-[1.75rem]"
      >
        <div className="relative bg-[#1a1d1f] px-6 pb-5 pt-6 text-white">
          <button
            type="button"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg text-white transition hover:bg-white/20"
            onClick={closeAuth}
            aria-label="Close"
          >
            ×
          </button>
          <h2 id={titleId} className="pr-10 text-2xl font-bold tracking-tight">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/75">{subtitle}</p>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto bg-[#b5e5d1] px-5 pb-6 pt-5">
          {panel === 'login' && (
            <LoginForm
              onSwitchRegister={() => setPanel('register')}
              onForgot={() => setPanel('forgot')}
            />
          )}
          {panel === 'register' && (
            <RegisterForm onSwitchLogin={() => setPanel('login')} />
          )}
          {panel === 'forgot' && <ForgotPasswordForm onBack={() => setPanel('login')} />}
        </div>
      </div>
    </div>
  )
}
