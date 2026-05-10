import { useEffect, useId, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useSearchParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { useAuthModal } from '../authModalContext'
import { playerFetch } from '../lib/playerFetch'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'

/** Query param on `/casino/games` (etc.) while completing email reset — never used in outbound email bodies. */
export const PASSWORD_RESET_TOKEN_PARAM = 'passwordResetToken'

/** Email links use `/reset-password?token=…`; replace onto catalog with modal param. */
export function ResetPasswordEmailRedirect() {
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() ?? ''
  if (!token) return <Navigate to="/casino/games" replace />
  const q = new URLSearchParams()
  q.set(PASSWORD_RESET_TOKEN_PARAM, token)
  return <Navigate to={`/casino/games?${q}`} replace />
}

type ResetPasswordModalProps = {
  open: boolean
  token: string
  onClose: () => void
}

export const ResetPasswordModal: FC<ResetPasswordModalProps> = ({ open, token, onClose }) => {
  const { openAuth } = useAuthModal()
  const titleId = useId()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setConfirm('')
    setShowPw(false)
    setErr(null)
    setOk(false)
    setLoading(false)
  }, [open, token])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!token) {
      setErr('Missing token in link')
      return
    }
    if (password !== confirm) {
      setErr('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const res = await playerFetch('/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const p = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(p, res.status, 'POST /v1/auth/reset-password', rid)
        setErr(formatApiError(p, 'Reset failed'))
        return
      }
      setOk(true)
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/auth/reset-password')
      setErr('Network error.')
    } finally {
      setLoading(false)
    }
  }

  function afterSuccessSignIn() {
    onClose()
    openAuth('login')
  }

  if (!open) return null

  return createPortal(
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-center justify-center p-4 sm:p-6`}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Close reset password"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[1] w-full max-w-md overflow-hidden rounded-casino-lg border border-white/[0.1] bg-casino-surface p-5 text-casino-foreground shadow-[0_18px_40px_rgba(0,0,0,0.28)] sm:p-6"
      >
        <button
          type="button"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-casino-md text-lg text-casino-muted transition hover:bg-casino-elevated hover:text-casino-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {ok ? (
          <div className="space-y-4 pt-1 text-center">
            <p className="text-sm text-casino-muted">Your password was updated. Sign in again.</p>
            <button
              type="button"
              className="text-sm font-semibold text-casino-primary hover:underline"
              onClick={afterSuccessSignIn}
            >
              Sign in
            </button>
          </div>
        ) : (
          <>
            <h1 id={titleId} className="pr-8 text-xl font-semibold text-casino-primary">
              Reset password
            </h1>
            <p className="mt-2 text-sm text-casino-muted">Choose a new password (6+ chars, letters and numbers).</p>
            {err && (
              <p className="mt-4 rounded-casino-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {err}
              </p>
            )}
            <form className="mt-5 space-y-4" onSubmit={(e) => void onSubmit(e)}>
              <div>
                <label htmlFor="reset-pw-modal" className="mb-1 block text-xs text-casino-muted">
                  New password
                </label>
                <div className="flex gap-2">
                  <input
                    id="reset-pw-modal"
                    type={showPw ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    autoFocus
                    className="min-w-0 flex-1 rounded-casino-md border border-casino-border bg-casino-bg px-3 py-2 text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-casino-md border border-casino-border px-3 text-xs"
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="reset-confirm-modal" className="mb-1 block text-xs text-casino-muted">
                  Confirm
                </label>
                <input
                  id="reset-confirm-modal"
                  type={showPw ? 'text' : 'password'}
                  required
                  minLength={6}
                  className="w-full rounded-casino-md border border-casino-border bg-casino-bg px-3 py-2 text-sm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-casino-md bg-casino-primary py-2.5 text-sm font-medium text-casino-bg disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Update password'}
              </button>
            </form>
            <button
              type="button"
              className="mt-4 text-sm text-casino-primary hover:underline"
              onClick={() => {
                onClose()
                openAuth('login')
              }}
            >
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
