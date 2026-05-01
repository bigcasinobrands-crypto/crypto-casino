import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import PageMeta from '../components/common/PageMeta'
import { toastApiError } from '../notifications/adminToast'

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
  const { accessToken, login, finishMfaWebAuthn } = useAdminAuth()
  const [loginForm, setLoginForm] = useState(() => readInitialLoginState())
  const { email, password, rememberPassword } = loginForm
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaBusy, setMfaBusy] = useState(false)

  if (accessToken) return <Navigate to="/" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    const r = await login(email, password)
    setLoading(false)
    if (r.status === 'mfa_pending') {
      setMfaToken(r.mfaToken)
      return
    }
    if (r.status === 'error') {
      toastApiError(r.error, r.error.status, 'POST /v1/admin/auth/login')
      setErr(formatApiError(r.error, 'Invalid credentials'))
      return
    }
    setMfaToken(null)
    persistLoginCredentials(rememberPassword, email, password)
  }

  async function onWebAuthnMfa() {
    if (!mfaToken) return
    setErr(null)
    setMfaBusy(true)
    const r = await finishMfaWebAuthn(mfaToken)
    setMfaBusy(false)
    if (r.status === 'error') {
      toastApiError(r.error, r.error.status, 'POST /v1/admin/auth/mfa/webauthn/finish')
      setErr(formatApiError(r.error, 'Security key verification failed'))
      return
    }
    setMfaToken(null)
    persistLoginCredentials(rememberPassword, email, password)
  }

  function cancelMfa() {
    setMfaToken(null)
    setErr(null)
  }

  return (
    <div
      className="d-flex min-vh-100 flex-column flex-lg-row"
      style={{
        background:
          'linear-gradient(165deg, var(--bs-body-bg) 0%, var(--bs-secondary-bg) 48%, var(--bs-body-bg) 100%)',
      }}
    >
      <PageMeta title="Sign in · Admin" description="Staff sign-in — Crypto Casino admin console" />

      <div className="position-relative d-flex flex-grow-1 flex-column justify-content-center px-3 px-sm-4 py-5 px-lg-5">
        <div className="mx-auto w-100" style={{ maxWidth: '26rem' }}>
          <div className="card shadow-lg border-secondary-subtle rounded-3 bg-body">
            <div className="card-body p-4 p-sm-5">
              <div className="d-flex align-items-center gap-3 pb-4 border-bottom border-secondary-subtle">
                <Link
                  to="/"
                  className="d-flex align-items-center gap-3 text-decoration-none text-body-emphasis"
                >
                  <img
                    src="/images/logo/logo-icon.svg"
                    alt=""
                    width={44}
                    height={44}
                    className="rounded-2 shadow-sm"
                  />
                  <span className="fw-semibold fs-6">Crypto Casino</span>
                </Link>
              </div>

              <h1 className="h4 fw-semibold text-body-emphasis mt-4 mb-2">Staff sign in</h1>
              <p className="small text-secondary mb-0 lh-base">
                Sign in with your staff email and password. If you need access, contact an administrator.
              </p>
              {import.meta.env.DEV ? (
                <div className="alert alert-warning py-2 px-3 small mt-3 mb-0 border-warning-subtle">
                  Local dev: form defaults match the seeded admin user after running migrations.
                </div>
              ) : null}

              <div className="mt-4">
                {err ? (
                  <div className="alert alert-danger py-2 small mb-3" role="alert">
                    {err}
                  </div>
                ) : null}

                {mfaToken ? (
                  <div className="rounded border border-secondary-subtle bg-body-secondary px-3 py-3 mb-2">
                    <p className="small text-secondary mb-3 mb-lg-4">
                      Password accepted. Use your registered security key to finish sign-in.
                    </p>
                    <div className="d-flex flex-column gap-2 flex-sm-row">
                      <button
                        type="button"
                        disabled={mfaBusy}
                        onClick={() => void onWebAuthnMfa()}
                        className="btn btn-primary flex-grow-1"
                      >
                        {mfaBusy ? 'Waiting for security key…' : 'Continue with security key'}
                      </button>
                      <button
                        type="button"
                        disabled={mfaBusy}
                        onClick={cancelMfa}
                        className="btn btn-outline-secondary"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={(e) => void onSubmit(e)} className="d-flex flex-column gap-3">
                    <div>
                      <label htmlFor="admin-email" className="form-label small fw-semibold mb-1">
                        Email
                      </label>
                      <input
                        id="admin-email"
                        type="email"
                        name="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder={DEFAULT_ADMIN_EMAIL}
                        className="form-control form-control-lg"
                      />
                    </div>

                    <div>
                      <label htmlFor="admin-password" className="form-label small fw-semibold mb-1">
                        Password
                      </label>
                      <div className="input-group input-group-lg">
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
                          className="form-control"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw((v) => !v)}
                          className="btn btn-outline-secondary px-3 d-inline-flex align-items-center justify-content-center"
                          style={{ minWidth: '3rem' }}
                          aria-label={showPw ? 'Hide password' : 'Show password'}
                          aria-pressed={showPw}
                        >
                          <i
                            className={`bi ${showPw ? 'bi-eye-slash-fill' : 'bi-eye-fill'} fs-5 text-body`}
                            aria-hidden
                          />
                        </button>
                      </div>
                    </div>

                    <div className="form-check mt-1">
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
                        className="form-check-input"
                      />
                      <label htmlFor="admin-remember-password" className="form-check-label small">
                        Remember email and password on this device
                      </label>
                    </div>

                    <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-100 mt-1">
                      {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="d-none d-lg-flex flex-lg-grow-1 flex-column justify-content-center align-items-center px-5 py-5 text-center position-relative overflow-hidden border-start border-secondary-subtle"
        data-bs-theme="dark"
        style={{
          minHeight: '100vh',
          background:
            'linear-gradient(145deg, #1a1d24 0%, #12151a 45%, #0d0f12 100%)',
        }}
      >
        <div
          className="position-absolute top-0 start-0 w-100 h-100 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 30% 20%, rgba(13,110,253,0.35), transparent 45%),
              url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' fill='white' opacity='0.12'%3E%3Cpath d='M0 0h14v14H0zm14 14h14v14H14z'/%3E%3C/svg%3E")`,
            backgroundSize: 'auto, 28px 28px',
          }}
          aria-hidden
        />
        <div className="position-relative z-1">
          <div className="mb-4 d-flex justify-content-center">
            <img
              src="/images/logo/logo-icon.svg"
              alt=""
              width={88}
              height={88}
              className="rounded-3 shadow-lg"
            />
          </div>
          <p className="fs-5 fw-semibold text-white mb-1">Crypto Casino</p>
          <p className="text-secondary small mb-3">Staff console</p>
          <p className="small text-secondary mb-0 mx-auto opacity-90" style={{ maxWidth: '22rem' }}>
            Staff tools, live data, secure access — same mark as the signed-in sidebar.
          </p>
        </div>
      </div>
    </div>
  )
}
