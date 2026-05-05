import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthModal } from '../authModalContext'
import { formatApiError, readApiError } from '../api/errors'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { TurnstileField } from './TurnstileField'
import { playerApiOriginConfigured } from '../lib/playerApiUrl'
import { usePlayerAuth } from '../playerAuth'
import { IconCheck, IconEye, IconEyeOff, IconLock, IconUser } from './icons'

function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-casino-md border border-red-500/35 bg-red-950/40 px-2 py-1 text-[11px] leading-snug text-red-200 sm:px-2.5 sm:py-1.5 sm:text-xs"
    >
      {children}
    </p>
  )
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[10px] font-semibold text-casino-muted sm:text-[11px]">
      {children}
    </label>
  )
}

function InputRow({
  children,
  right,
}: {
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div
      className="flex min-h-9 items-center gap-1.5 rounded-casino-md border border-white/[0.12] bg-casino-elevated px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_2px_rgba(0,0,0,0.2)] transition-[box-shadow,border-color,background-color] focus-within:border-casino-primary/40 focus-within:bg-casino-elevated focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(123,97,255,0.22),0_2px_8px_rgba(123,97,255,0.08)] sm:min-h-10 sm:gap-2 sm:px-3"
    >
      {children}
      {right ? <div className="flex shrink-0 items-center">{right}</div> : null}
    </div>
  )
}

const authInputClass =
  'min-w-0 flex-1 bg-transparent py-1 text-[12px] text-casino-foreground caret-casino-primary outline-none placeholder:text-casino-muted/85 sm:py-1.5 sm:text-[13px]'

const authPrimaryBtnClass =
  'flex min-h-9 w-full items-center justify-center rounded-casino-md bg-casino-primary text-[13px] font-semibold text-white shadow-md transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-50 sm:min-h-10 sm:text-sm'

function CheckLine({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-1.5 text-[10px] leading-snug text-casino-muted sm:gap-2 sm:text-[11px]">
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={`mt-px flex size-4 shrink-0 items-center justify-center rounded border sm:size-[18px] ${
          checked ? 'border-casino-primary bg-casino-primary' : 'border-casino-border bg-casino-elevated'
        }`}
        aria-hidden
      >
        <IconCheck size={12} className={`text-white ${checked ? 'opacity-100' : 'opacity-0'}`} strokeWidth={2.5} />
      </span>
      <span className="min-w-0 text-casino-muted [&_strong]:font-semibold [&_strong]:text-casino-foreground">
        {children}
      </span>
    </label>
  )
}

export function LoginForm({
  rememberStorageKey,
  idPrefix = 'm',
}: {
  rememberStorageKey: string
  idPrefix?: string
}) {
  const { t } = useTranslation()
  const { schedulePostAuthContinuation } = useAuthModal()
  const location = useLocation()
  const registerTo = useMemo(() => {
    const q = new URLSearchParams(location.search)
    q.set('auth', 'register')
    return { pathname: location.pathname, search: `?${q.toString()}` }
  }, [location.pathname, location.search])
  const forgotTo = useMemo(() => {
    const q = new URLSearchParams(location.search)
    q.set('auth', 'forgot')
    return { pathname: location.pathname, search: `?${q.toString()}` }
  }, [location.pathname, location.search])

  const { login } = usePlayerAuth()
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(rememberStorageKey) ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    const r = await login(email, password, captcha ?? undefined)
    setLoading(false)
    if (!r.ok) {
      toastPlayerApiError(r.error, r.error?.status ?? 0, 'POST /v1/auth/login')
      setErr(formatApiError(r.error, t('auth.signInFailed')))
      return
    }
    try {
      if (remember && email.trim()) localStorage.setItem(rememberStorageKey, email.trim())
      else localStorage.removeItem(rememberStorageKey)
    } catch {
      /* ignore */
    }
    schedulePostAuthContinuation()
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-2.5">
      {import.meta.env.PROD && !playerApiOriginConfigured() ? (
        <AuthError>
          Production build has no <span className="font-mono text-[10px]">VITE_PLAYER_API_ORIGIN</span>. Set it in
          Vercel → Environment Variables to your public core API URL (https://…), redeploy, and add this site URL to{' '}
          <span className="font-mono text-[10px]">PLAYER_CORS_ORIGINS</span> on the API.
        </AuthError>
      ) : null}
      {err ? <AuthError>{err}</AuthError> : null}
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2.5 sm:gap-3">
        <div className="flex flex-col gap-1 sm:gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-login-email`}>{t('auth.login.emailOrUsername')}</FieldLabel>
          <InputRow>
            <IconUser size={14} className="shrink-0 text-casino-muted max-sm:scale-90" aria-hidden />
            <input
              id={`${idPrefix}-login-email`}
              className={authInputClass}
              type="text"
              name="username"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.login.emailOrUsernamePlaceholder')}
            />
          </InputRow>
        </div>

        <div className="flex flex-col gap-1 sm:gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-login-pw`}>{t('auth.login.password')}</FieldLabel>
          <InputRow
            right={
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-casino-sm text-casino-muted transition hover:text-casino-foreground sm:h-7 sm:w-7"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
              >
                {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
            }
          >
            <IconLock size={14} className="max-sm:scale-90 shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-login-pw`}
              className={authInputClass}
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.login.passwordPlaceholder')}
            />
          </InputRow>
        </div>

        <TurnstileField onToken={setCaptcha} />

        <div className="flex items-center justify-between gap-1.5 sm:gap-2">
          <label className="flex min-w-0 cursor-pointer items-center gap-1.5 text-[10px] leading-snug text-casino-muted sm:gap-2 sm:text-[11px]">
            <input
              type="checkbox"
              className="sr-only"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span
              className={`flex size-4 shrink-0 items-center justify-center rounded border sm:size-[18px] ${
                remember ? 'border-casino-primary bg-casino-primary' : 'border-casino-border bg-casino-elevated'
              }`}
              aria-hidden
            >
              <IconCheck
                size={12}
                className={`text-white ${remember ? 'opacity-100' : 'opacity-0'}`}
                strokeWidth={2.5}
              />
            </span>
            <span>{t('auth.login.rememberMe')}</span>
          </label>
          <Link
            to={forgotTo}
            replace
            className="shrink-0 text-[10px] font-semibold text-casino-foreground transition hover:text-casino-primary sm:text-[11px]"
          >
            {t('auth.login.forgotPassword')}
          </Link>
        </div>

        <button type="submit" disabled={loading} className={authPrimaryBtnClass}>
          {loading ? t('auth.login.signingIn') : t('auth.login.signInCta')}
        </button>
      </form>

      <Link
        to={registerTo}
        replace
        aria-label={t('auth.login.registerAria')}
        className="mt-2 flex w-full items-center justify-center gap-1.5 py-0.5 text-[11px] text-casino-muted transition hover:text-casino-foreground sm:mt-3 sm:text-xs"
      >
        <span>{t('auth.login.noAccount')}</span>
        <span className="font-semibold text-casino-foreground underline-offset-2 hover:underline">
          {t('auth.login.registerLink')}
        </span>
      </Link>
    </div>
  )
}

export function RegisterForm({ idPrefix = 'm' }: { idPrefix?: string }) {
  const { t } = useTranslation()
  const { schedulePostAuthContinuation } = useAuthModal()
  const location = useLocation()
  const loginTo = useMemo(() => {
    const q = new URLSearchParams(location.search)
    q.set('auth', 'login')
    return { pathname: location.pathname, search: `?${q.toString()}` }
  }, [location.pathname, location.search])

  const { register } = usePlayerAuth()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [acceptPrivacy, setAcceptPrivacy] = useState(false)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!username.trim()) {
      setErr(t('auth.registerForm.usernameRequired'))
      return
    }
    if (password !== confirm) {
      setErr(t('auth.registerForm.passwordsMismatch'))
      return
    }
    if (!acceptTerms || !acceptPrivacy) {
      setErr(t('auth.acceptTermsError'))
      return
    }
    setLoading(true)
    const r = await register({
      email,
      password,
      username: username.trim(),
      acceptTerms,
      acceptPrivacy,
      captchaToken: captcha ?? undefined,
    })
    setLoading(false)
    if (!r.ok) {
      toastPlayerApiError(r.error, r.error?.status ?? 0, 'POST /v1/auth/register')
      setErr(formatApiError(r.error, t('auth.registerForm.registrationFailed')))
      return
    }
    schedulePostAuthContinuation()
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-2.5">
      {import.meta.env.PROD && !playerApiOriginConfigured() ? (
        <AuthError>
          Production build has no <span className="font-mono text-[10px]">VITE_PLAYER_API_ORIGIN</span>. Set it in
          Vercel → Environment Variables to your public core API URL (https://…), redeploy, and add this site URL to{' '}
          <span className="font-mono text-[10px]">PLAYER_CORS_ORIGINS</span> on the API.
        </AuthError>
      ) : null}
      {err ? <AuthError>{err}</AuthError> : null}
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2.5 sm:gap-3">
        <div className="flex flex-col gap-1 sm:gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-reg-email`}>{t('auth.registerForm.email')}</FieldLabel>
          <InputRow>
            <IconUser size={14} className="max-sm:scale-90 shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-email`}
              className={authInputClass}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.registerForm.emailPlaceholder')}
            />
          </InputRow>
        </div>

        <div className="flex flex-col gap-1 sm:gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-reg-username`}>{t('auth.registerForm.username')}</FieldLabel>
          <InputRow>
            <IconUser size={14} className="max-sm:scale-90 shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-username`}
              className={authInputClass}
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth.registerForm.usernamePlaceholder')}
            />
          </InputRow>
          <span className="text-[9px] text-casino-muted sm:text-[10px]">{t('auth.registerForm.usernameHint')}</span>
        </div>

        <div className="flex flex-col gap-1 sm:gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-reg-pw`}>{t('auth.registerForm.createPassword')}</FieldLabel>
          <InputRow
            right={
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-casino-sm text-casino-muted transition hover:text-casino-foreground sm:h-7 sm:w-7"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t('auth.registerForm.hidePassword') : t('auth.registerForm.showPassword')}
              >
                {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
            }
          >
            <IconLock size={14} className="max-sm:scale-90 shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-pw`}
              className={authInputClass}
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.registerForm.passwordPlaceholder')}
            />
          </InputRow>
        </div>

        <div className="flex flex-col gap-1 sm:gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-reg-confirm`}>{t('auth.registerForm.confirmPassword')}</FieldLabel>
          <InputRow>
            <IconLock size={14} className="max-sm:scale-90 shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-confirm`}
              className={authInputClass}
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={12}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t('auth.registerForm.confirmPlaceholder')}
            />
          </InputRow>
        </div>

        <CheckLine checked={acceptTerms} onChange={setAcceptTerms}>
          {t('auth.registerAcceptTerms')}
        </CheckLine>
        <CheckLine checked={acceptPrivacy} onChange={setAcceptPrivacy}>
          {t('auth.registerAcceptPrivacy')}
        </CheckLine>

        <TurnstileField onToken={setCaptcha} />

        <button type="submit" disabled={loading} className={authPrimaryBtnClass}>
          {loading ? t('auth.registerForm.creating') : t('auth.registerForm.submit')}
        </button>
      </form>

      <Link
        to={loginTo}
        replace
        aria-label={t('auth.registerForm.signInAria')}
        className="mt-2 flex w-full items-center justify-center gap-1.5 py-0.5 text-[11px] text-casino-muted transition hover:text-casino-foreground sm:mt-3 sm:text-xs"
      >
        <span>{t('auth.registerForm.alreadyHaveAccount')}</span>
        <span className="font-semibold text-casino-foreground underline-offset-2 hover:underline">
          {t('auth.registerForm.signInLink')}
        </span>
      </Link>
    </div>
  )
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await playerFetch('/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const p = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(p, res.status, 'POST /v1/auth/forgot-password', rid)
      }
    } catch {
      toastPlayerNetworkError(t('auth.forgotForm.networkError'), 'POST /v1/auth/forgot-password')
    } finally {
      setLoading(false)
      setDone(true)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-2 text-center text-[11px] text-casino-muted sm:gap-3 sm:text-xs">
        <p>{t('auth.forgotForm.resetSent')}</p>
        <button type="button" className={authPrimaryBtnClass} onClick={onBack}>
          {t('auth.forgotForm.backToLogin')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-2.5">
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2.5 sm:gap-3">
        <div className="flex flex-col gap-1 sm:gap-1.5">
          <FieldLabel htmlFor="m-forgot-email">{t('auth.forgotForm.email')}</FieldLabel>
          <InputRow>
            <IconUser size={14} className="max-sm:scale-90 shrink-0 text-casino-muted" aria-hidden />
            <input
              id="m-forgot-email"
              className={authInputClass}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.forgotForm.emailPlaceholder')}
            />
          </InputRow>
        </div>
        <button type="submit" disabled={loading} className={authPrimaryBtnClass}>
          {loading ? t('auth.forgotForm.sending') : t('auth.forgotForm.sendResetLink')}
        </button>
      </form>
      <button
        type="button"
        className="w-full text-[10px] font-semibold text-casino-foreground transition hover:text-casino-primary sm:text-[11px]"
        onClick={onBack}
      >
        {t('auth.forgotForm.backToLogin')}
      </button>
    </div>
  )
}
