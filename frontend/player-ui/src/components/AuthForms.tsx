import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthModal } from '../authModalContext'
import { formatApiError, readApiError } from '../api/errors'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { TurnstileField } from './TurnstileField'
import { usePlayerAuth } from '../playerAuth'
import { IconCheck, IconEye, IconEyeOff, IconLock, IconUser } from './icons'

function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-casino-md border border-red-500/35 bg-red-950/40 px-2.5 py-1.5 text-xs leading-snug text-red-200"
    >
      {children}
    </p>
  )
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[11px] font-semibold text-casino-foreground">
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
    <div className="flex min-h-10 items-center gap-2 rounded-casino-md bg-casino-surface px-3 transition-shadow focus-within:ring-1 focus-within:ring-casino-primary/35">
      {children}
      {right ? <div className="flex shrink-0 items-center">{right}</div> : null}
    </div>
  )
}

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
    <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-snug text-casino-muted">
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={`mt-px flex size-[18px] shrink-0 items-center justify-center rounded border ${
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
      setErr(formatApiError(r.error, 'Sign in failed'))
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
    <div className="flex flex-col gap-2">
      {err ? <AuthError>{err}</AuthError> : null}
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idPrefix}-login-email`}>Email or username</FieldLabel>
          <InputRow>
            <IconUser size={14} className="shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-login-email`}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-casino-foreground outline-none placeholder:text-casino-muted"
              type="text"
              name="username"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com or username"
            />
          </InputRow>
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idPrefix}-login-pw`}>Password</FieldLabel>
          <InputRow
            right={
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-casino-sm text-casino-muted transition hover:text-casino-foreground"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
            }
          >
            <IconLock size={14} className="shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-login-pw`}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-casino-foreground outline-none placeholder:text-casino-muted"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </InputRow>
        </div>

        <TurnstileField onToken={setCaptcha} />

        <div className="flex items-center justify-between gap-2">
          <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[11px] leading-snug text-casino-muted">
            <input
              type="checkbox"
              className="sr-only"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span
              className={`flex size-[18px] shrink-0 items-center justify-center rounded border ${
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
            <span>Remember me</span>
          </label>
          <Link
            to={forgotTo}
            replace
            className="shrink-0 text-[11px] font-semibold text-casino-foreground transition hover:text-casino-primary"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex min-h-10 w-full items-center justify-center rounded-casino-md bg-casino-primary text-sm font-semibold text-white shadow-md transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <Link
        to={registerTo}
        replace
        aria-label="Create an account — register"
        className="mt-3 flex w-full items-center justify-center gap-1.5 py-0.5 text-xs text-casino-muted transition hover:text-casino-foreground"
      >
        <span>Don&apos;t have an account?</span>
        <span className="font-semibold text-casino-foreground underline-offset-2 hover:underline">Register</span>
      </Link>
    </div>
  )
}

export function RegisterForm({ idPrefix = 'm' }: { idPrefix?: string }) {
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
      setErr('Please choose a username')
      return
    }
    if (password !== confirm) {
      setErr('Passwords do not match')
      return
    }
    if (!acceptTerms || !acceptPrivacy) {
      setErr('Please accept the terms and privacy policy')
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
      setErr(formatApiError(r.error, 'Registration failed'))
      return
    }
    schedulePostAuthContinuation()
  }

  return (
    <div className="flex flex-col gap-2">
      {err ? <AuthError>{err}</AuthError> : null}
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idPrefix}-reg-email`}>Email</FieldLabel>
          <InputRow>
            <IconUser size={14} className="shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-email`}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-casino-foreground outline-none placeholder:text-casino-muted"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </InputRow>
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idPrefix}-reg-username`}>Username</FieldLabel>
          <InputRow>
            <IconUser size={14} className="shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-username`}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-casino-foreground outline-none placeholder:text-casino-muted"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
            />
          </InputRow>
          <span className="text-[10px] text-casino-muted">3-20 characters, letters, numbers, and underscores</span>
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idPrefix}-reg-pw`}>Create password</FieldLabel>
          <InputRow
            right={
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-casino-sm text-casino-muted transition hover:text-casino-foreground"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
            }
          >
            <IconLock size={14} className="shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-pw`}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-casino-foreground outline-none placeholder:text-casino-muted"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </InputRow>
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idPrefix}-reg-confirm`}>Confirm password</FieldLabel>
          <InputRow>
            <IconLock size={14} className="shrink-0 text-casino-muted" aria-hidden />
            <input
              id={`${idPrefix}-reg-confirm`}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-casino-foreground outline-none placeholder:text-casino-muted"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={12}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
            />
          </InputRow>
        </div>

        <CheckLine checked={acceptTerms} onChange={setAcceptTerms}>
          I accept the <strong>Terms of Service</strong>.
        </CheckLine>
        <CheckLine checked={acceptPrivacy} onChange={setAcceptPrivacy}>
          I accept the <strong>Privacy Policy</strong>.
        </CheckLine>

        <TurnstileField onToken={setCaptcha} />

        <button
          type="submit"
          disabled={loading}
          className="flex min-h-10 w-full items-center justify-center rounded-casino-md bg-casino-primary text-sm font-semibold text-white shadow-md transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Register'}
        </button>
      </form>

      <Link
        to={loginTo}
        replace
        aria-label="Sign in — already have an account"
        className="mt-3 flex w-full items-center justify-center gap-1.5 py-0.5 text-xs text-casino-muted transition hover:text-casino-foreground"
      >
        <span>Already have an account?</span>
        <span className="font-semibold text-casino-foreground underline-offset-2 hover:underline">Sign in</span>
      </Link>
    </div>
  )
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
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
      toastPlayerNetworkError('Could not reach server.', 'POST /v1/auth/forgot-password')
    } finally {
      setLoading(false)
      setDone(true)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3 text-center text-xs text-casino-muted">
        <p>If an account exists for that email, we sent reset instructions.</p>
        <button
          type="button"
          className="flex min-h-10 w-full items-center justify-center rounded-casino-md bg-casino-primary text-sm font-semibold text-white shadow-md transition hover:brightness-110"
          onClick={onBack}
        >
          Back to log in
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="m-forgot-email">Email</FieldLabel>
          <InputRow>
            <IconUser size={14} className="shrink-0 text-casino-muted" aria-hidden />
            <input
              id="m-forgot-email"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-casino-foreground outline-none placeholder:text-casino-muted"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </InputRow>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex min-h-10 w-full items-center justify-center rounded-casino-md bg-casino-primary text-sm font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <button
        type="button"
        className="w-full text-[11px] font-semibold text-casino-foreground transition hover:text-casino-primary"
        onClick={onBack}
      >
        Back to log in
      </button>
    </div>
  )
}
