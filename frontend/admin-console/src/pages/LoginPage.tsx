import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { toastApiError } from '../notifications/adminToast'
import GridShape from '../components/common/GridShape'
import PageMeta from '../components/common/PageMeta'
import { EyeCloseIcon, EyeIcon } from '../icons'

/** Default staff login (matches seeded row after migrations; override via bootstrap if needed). */
const DEFAULT_ADMIN_EMAIL = 'admin@twox.gg'
const DEFAULT_ADMIN_PASSWORD = 'testadmin123'

const LS_REMEMBER = 'admin_login_remember'
const LS_EMAIL = 'admin_saved_email'
const LS_PASSWORD = 'admin_saved_password'

function readInitialLoginState(): {
  email: string
  password: string
  rememberPassword: boolean
} {
  if (typeof window === 'undefined') {
    return {
      email: DEFAULT_ADMIN_EMAIL,
      password: DEFAULT_ADMIN_PASSWORD,
      rememberPassword: false,
    }
  }
  try {
    if (localStorage.getItem(LS_REMEMBER) === '1') {
      return {
        email: localStorage.getItem(LS_EMAIL) || DEFAULT_ADMIN_EMAIL,
        password: localStorage.getItem(LS_PASSWORD) || DEFAULT_ADMIN_PASSWORD,
        rememberPassword: true,
      }
    }
  } catch {
    /* storage unavailable */
  }
  return {
    email: DEFAULT_ADMIN_EMAIL,
    password: DEFAULT_ADMIN_PASSWORD,
    rememberPassword: false,
  }
}

function persistLoginCredentials(remember: boolean, email: string, password: string) {
  try {
    if (remember) {
      localStorage.setItem(LS_REMEMBER, '1')
      localStorage.setItem(LS_EMAIL, email)
      localStorage.setItem(LS_PASSWORD, password)
    } else {
      localStorage.removeItem(LS_REMEMBER)
      localStorage.removeItem(LS_EMAIL)
      localStorage.removeItem(LS_PASSWORD)
    }
  } catch {
    /* ignore */
  }
}

export default function LoginPage() {
  const { accessToken, login } = useAdminAuth()
  const [loginForm, setLoginForm] = useState(() => readInitialLoginState())
  const { email, password, rememberPassword } = loginForm
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (accessToken) return <Navigate to="/" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    const r = await login(email, password)
    setLoading(false)
    if (!r.ok) {
      toastApiError(r.error, r.error.status, 'POST /v1/admin/auth/login')
      setErr(formatApiError(r.error, 'Invalid credentials'))
      return
    }
    persistLoginCredentials(rememberPassword, email, password)
  }

  return (
    <div className="relative z-1 flex min-h-screen flex-col bg-white dark:bg-gray-900 lg:flex-row">
      <PageMeta title="Sign in · Admin" description="Staff sign-in for Crypto Casino admin" />

      <div className="relative flex w-full flex-1 flex-col justify-center px-4 py-10 sm:px-6 lg:w-1/2 lg:px-10 xl:px-16">
        <div className="relative z-10 mx-auto w-full max-w-md">
          <GridShape />
          <div className="mb-8">
            <Link to="/" className="mb-6 inline-block lg:hidden">
              <img className="h-8 dark:hidden" src="/images/logo/logo.svg" alt="Logo" />
              <img className="hidden h-8 dark:block" src="/images/logo/logo-dark.svg" alt="Logo" />
            </Link>
            <div className="mb-6 hidden lg:block">
              <img className="h-10 dark:hidden" src="/images/logo/logo.svg" alt="Logo" />
              <img className="hidden h-10 dark:block" src="/images/logo/logo-dark.svg" alt="Logo" />
            </div>
            <h1 className="mb-2 text-title-md font-semibold text-gray-800 dark:text-white/90 sm:text-title-lg">
              Staff sign in
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Staff accounts and password hashes live in Postgres (<code className="font-mono text-xs">staff_users</code>).
              Sign-in is validated by the API only; defaults below match the seeded dev row after migrations.
            </p>
          </div>

          <form onSubmit={(e) => void onSubmit(e)} className="space-y-5">
            {err && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                {err}
              </div>
            )}

            <div>
              <label
                htmlFor="admin-email"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) =>
                  setLoginForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder={DEFAULT_ADMIN_EMAIL}
                className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPw ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) =>
                    setLoginForm((f) => ({ ...f, password: e.target.value }))
                  }
                  placeholder="••••••••"
                  className="h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pr-12 pl-4 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute top-1/2 right-3 z-30 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white/80"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? (
                    <EyeCloseIcon className="size-5" />
                  ) : (
                    <EyeIcon className="size-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <input
                id="admin-remember-password"
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) =>
                  setLoginForm((f) => ({
                    ...f,
                    rememberPassword: e.target.checked,
                  }))
                }
                className="mt-0.5 size-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-900"
              />
              <label
                htmlFor="admin-remember-password"
                className="text-sm leading-snug text-gray-600 dark:text-gray-400"
              >
                Remember email and password on this device
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      <div className="relative hidden h-auto flex-1 items-center justify-center bg-brand-950 p-10 lg:flex lg:w-1/2">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(70,95,255,0.35)_0%,transparent_50%)]" />
        <div className="relative z-10 max-w-md text-center">
          <div className="mb-10 flex justify-center">
            <img src="/images/logo/auth-logo.svg" alt="" className="h-24 w-auto opacity-95" />
          </div>
          <p className="text-xl font-medium text-white/95">Crypto Casino</p>
          <p className="mt-2 text-sm text-white/70">Staff tools, live data, secure access.</p>
        </div>
        <div className="absolute right-0 bottom-0 opacity-20">
          <img src="/images/shape/grid-01.svg" alt="" className="max-w-xs rotate-180" />
        </div>
      </div>
    </div>
  )
}
