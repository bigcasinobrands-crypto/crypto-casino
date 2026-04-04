import { useState } from 'react'
import { formatApiError } from '../api/errors'
import { playerApiUrl } from '../lib/playerApiUrl'
import { TurnstileField } from './TurnstileField'
import { usePlayerAuth } from '../playerAuth'

type NavProps = {
  onSwitchRegister: () => void
  onForgot: () => void
}

export function LoginForm({ onSwitchRegister, onForgot, idPrefix = 'm' }: NavProps & { idPrefix?: string }) {
  const { login } = usePlayerAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    const r = await login(email, password, captcha ?? undefined)
    setLoading(false)
    if (!r.ok) setErr(formatApiError(r.error, 'Sign in failed'))
  }

  return (
    <div className="space-y-4">
      {err && (
        <p className="rounded-2xl border border-red-600/30 bg-red-500/15 px-3 py-2 text-sm text-red-900">
          {err}
        </p>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div>
          <label htmlFor={`${idPrefix}-login-email`} className="mb-1 block text-xs font-medium text-[#1a1d1f]/80">
            Email
          </label>
          <input
            id={`${idPrefix}-login-email`}
            className="auth-modal-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-login-pw`} className="mb-1 block text-xs font-medium text-[#1a1d1f]/80">
            Password
          </label>
          <div className="relative">
            <input
              id={`${idPrefix}-login-pw`}
              className="auth-modal-input pr-12"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#1a1d1f]/60"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <TurnstileField onToken={setCaptcha} />
        <button type="submit" disabled={loading} className="auth-modal-btn-primary disabled:opacity-50">
          {loading ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      <div className="flex flex-col items-center gap-2 text-center text-sm text-[#1a1d1f]/80">
        <button type="button" className="font-medium text-[#1a1d1f] underline" onClick={onForgot}>
          Forgot password?
        </button>
        <p>
          Don&apos;t have an account?{' '}
          <button type="button" className="font-semibold text-[#1a1d1f] underline" onClick={onSwitchRegister}>
            Sign up
          </button>
        </p>
      </div>
    </div>
  )
}

export function RegisterForm({ onSwitchLogin, idPrefix = 'm' }: { onSwitchLogin: () => void; idPrefix?: string }) {
  const { register } = usePlayerAuth()
  const [email, setEmail] = useState('')
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
      acceptTerms,
      acceptPrivacy,
      captchaToken: captcha ?? undefined,
    })
    setLoading(false)
    if (!r.ok) setErr(formatApiError(r.error, 'Registration failed'))
  }

  return (
    <div className="space-y-4">
      {err && (
        <p className="rounded-2xl border border-red-600/30 bg-red-500/15 px-3 py-2 text-sm text-red-900">
          {err}
        </p>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div>
          <label htmlFor={`${idPrefix}-reg-email`} className="mb-1 block text-xs font-medium text-[#1a1d1f]/80">
            Email
          </label>
          <input
            id={`${idPrefix}-reg-email`}
            className="auth-modal-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-reg-pw`} className="mb-1 block text-xs font-medium text-[#1a1d1f]/80">
            Create password
          </label>
          <div className="relative">
            <input
              id={`${idPrefix}-reg-pw`}
              className="auth-modal-input pr-12"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#1a1d1f]/60"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-reg-confirm`} className="mb-1 block text-xs font-medium text-[#1a1d1f]/80">
            Confirm password
          </label>
          <input
            id={`${idPrefix}-reg-confirm`}
            className="auth-modal-input"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={12}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <p className="text-xs text-[#1a1d1f]/70">12+ characters with letters and numbers.</p>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-[#1a1d1f]">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-[#1a1d1f]/30"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
          />
          <span>I accept the Terms of Service.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-[#1a1d1f]">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-[#1a1d1f]/30"
            checked={acceptPrivacy}
            onChange={(e) => setAcceptPrivacy(e.target.checked)}
          />
          <span>I accept the Privacy Policy.</span>
        </label>
        <TurnstileField onToken={setCaptcha} />
        <button type="submit" disabled={loading} className="auth-modal-btn-primary disabled:opacity-50">
          {loading ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p className="text-center text-sm text-[#1a1d1f]/80">
        Already have an account?{' '}
        <button type="button" className="font-semibold text-[#1a1d1f] underline" onClick={onSwitchLogin}>
          Log in
        </button>
      </p>
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
    await fetch(playerApiUrl('/v1/auth/forgot-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setLoading(false)
    setDone(true)
  }

  if (done) {
    return (
      <div className="space-y-4 text-center text-sm text-[#1a1d1f]/85">
        <p>If an account exists for that email, we sent reset instructions.</p>
        <button type="button" className="auth-modal-btn-primary" onClick={onBack}>
          Back to log in
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div>
          <label htmlFor="m-forgot-email" className="mb-1 block text-xs font-medium text-[#1a1d1f]/80">
            Email
          </label>
          <input
            id="m-forgot-email"
            className="auth-modal-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button type="submit" disabled={loading} className="auth-modal-btn-primary disabled:opacity-50">
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <button type="button" className="w-full text-sm text-[#1a1d1f] underline" onClick={onBack}>
        Back to log in
      </button>
    </div>
  )
}
