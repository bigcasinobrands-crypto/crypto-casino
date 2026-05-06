import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useAuthModal, type AuthPanel } from '../authModalContext'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { useSiteContent } from '../hooks/useSiteContent'
import { usePlayerAuth } from '../playerAuth'
import { contentImageUrl } from '../lib/contentImageUrl'
import { ForgotPasswordForm, LoginForm, RegisterForm } from './AuthForms'
import { IconShieldCheck } from './icons'

const REMEMBER_KEY = 'player_remember_login_id'

export function AuthModal() {
  const { t } = useTranslation()
  const { panel, closeAuth, setPanel } = useAuthModal()
  const { isAuthenticated } = usePlayerAuth()
  const { getContent } = useSiteContent()
  const siteLabel = (getContent<string>('branding.site_name', '') ?? '').trim() || 'vybebet'
  const authDesktopVisualImage = contentImageUrl(getContent<string>('auth_desktop_visual_image', '') ?? '') ?? '/auth-side-visual.png'
  const [resolvedAuthDesktopVisualImage, setResolvedAuthDesktopVisualImage] = useState('/auth-side-visual.png')
  const titleId = useId()
  const descId = useId()

  const copy = useMemo(() => {
    const panels: Record<AuthPanel, { kicker: string; title: string; subtitle: string }> = {
      login: {
        kicker: t('auth.welcomeBack'),
        title: t('auth.signIn'),
        subtitle: t('auth.signInSubtitle'),
      },
      register: {
        kicker: t('auth.createAccount'),
        title: t('auth.register'),
        subtitle: t('auth.registerSubtitle'),
      },
      forgot: {
        kicker: t('auth.accountHelp'),
        title: t('auth.resetPassword'),
        subtitle: t('auth.resetSubtitle'),
      },
    }
    return panel ? panels[panel] : null
  }, [panel, t])

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

  useEffect(() => {
    if (!authDesktopVisualImage) {
      setResolvedAuthDesktopVisualImage('/auth-side-visual.png')
      return
    }
    let cancelled = false
    const preloader = new Image()
    preloader.onload = () => {
      if (!cancelled) setResolvedAuthDesktopVisualImage(authDesktopVisualImage)
    }
    preloader.onerror = () => {
      if (!cancelled) setResolvedAuthDesktopVisualImage('/auth-side-visual.png')
    }
    preloader.src = authDesktopVisualImage
    return () => {
      cancelled = true
    }
  }, [authDesktopVisualImage])

  if (!panel || !copy) return null

  return createPortal(
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-center justify-center p-2.5 sm:p-5`}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label={t('auth.close')}
        onClick={closeAuth}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={copy.subtitle ? descId : undefined}
        className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-[min(100%,380px)] flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth rounded-casino-lg border border-white/[0.1] bg-casino-surface p-4 text-casino-foreground shadow-[0_18px_40px_rgba(0,0,0,0.28)] sm:max-h-[calc(100dvh-1.5rem)] sm:max-w-[420px] sm:gap-3 sm:p-5 md:max-h-[min(calc(100dvh-2rem),44rem)] md:max-w-[min(94vw,980px)] md:flex-row md:gap-0 md:overflow-hidden md:p-0 scrollbar-casino"
      >
        <button
          type="button"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-casino-md text-sm text-casino-muted transition hover:bg-casino-elevated hover:text-casino-foreground sm:right-3 sm:top-3 sm:h-8 sm:w-8 sm:text-base"
          onClick={closeAuth}
          aria-label={t('auth.close')}
        >
          ×
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2 md:min-h-0 md:gap-2 md:p-4">
          <div className="flex justify-center pr-6 pt-0 sm:pr-7 md:justify-start md:pr-0">
            <span className="text-[15px] font-black tracking-tight text-white sm:text-lg">{siteLabel}</span>
          </div>

          <div className="flex flex-col items-center gap-0.5 pr-6 text-center sm:gap-1 sm:pr-7 md:items-start md:pr-0 md:text-left">
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
            <p id={descId} className="max-w-[280px] text-[11px] leading-snug text-casino-muted sm:max-w-[300px] sm:text-xs sm:leading-normal md:max-w-[360px]">
              {copy.subtitle}
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-1.5 sm:gap-2">
            {panel === 'login' && <LoginForm rememberStorageKey={REMEMBER_KEY} />}
            {panel === 'register' && <RegisterForm />}
            {panel === 'forgot' && <ForgotPasswordForm onBack={() => setPanel('login')} />}
          </div>
        </div>

        <aside className="relative hidden md:flex md:w-[38%] md:min-w-[260px] md:flex-col md:justify-between md:overflow-hidden md:border-l md:border-white/[0.08] lg:w-[40%]">
          <img
            src={resolvedAuthDesktopVisualImage}
            alt={t('auth.desktopVisualAlt')}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/55" />
        </aside>
      </div>
    </div>,
    document.body,
  )
}
