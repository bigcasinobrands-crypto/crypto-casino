import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { playerFetch } from '../lib/playerFetch'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = useMemo(() => params.get('token')?.trim() ?? '', [params])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)

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

  if (ok) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center">
        <p className="text-sm text-casino-muted">Your password was updated. Sign in again.</p>
        <Link className="text-casino-primary hover:underline" to="/?auth=login">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-8">
      <h1 className="text-xl font-semibold text-casino-primary">Reset password</h1>
      <p className="text-sm text-casino-muted">Choose a new password (12+ chars, letters and numbers).</p>
      {err && (
        <p className="rounded-casino-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="reset-pw" className="mb-1 block text-xs text-casino-muted">
            New password
          </label>
          <div className="flex gap-2">
            <input
              id="reset-pw"
              type={showPw ? 'text' : 'password'}
              required
              minLength={12}
              autoComplete="new-password"
              className="min-w-0 flex-1 rounded-casino-md border border-casino-border bg-casino-bg px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="rounded-casino-md border border-casino-border px-3 text-xs"
              onClick={() => setShowPw((v) => !v)}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="reset-confirm" className="mb-1 block text-xs text-casino-muted">
            Confirm
          </label>
          <input
            id="reset-confirm"
            type={showPw ? 'text' : 'password'}
            required
            minLength={12}
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
      <Link className="text-sm text-casino-primary hover:underline" to="/?auth=login">
        Back to sign in
      </Link>
    </div>
  )
}
