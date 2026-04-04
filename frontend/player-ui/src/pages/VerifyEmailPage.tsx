import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatApiError, readApiError } from '../api/errors'
import { playerApiUrl } from '../lib/playerApiUrl'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = useMemo(() => params.get('token')?.trim() ?? '', [params])
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)

  async function verify() {
    if (!token) {
      setErr('Missing token. Open the link from your email.')
      return
    }
    setErr(null)
    setLoading(true)
    const res = await fetch(playerApiUrl('/v1/auth/verify-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    setLoading(false)
    if (!res.ok) {
      setErr(formatApiError(await readApiError(res), 'Verification failed'))
      return
    }
    setOk(true)
  }

  if (ok) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center">
        <p className="text-sm text-casino-muted">Email verified. You can deposit and withdraw.</p>
        <Link className="text-casino-primary hover:underline" to="/">
          Go to games
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-8">
      <h1 className="text-xl font-semibold text-casino-primary">Verify email</h1>
      {token ? (
        <p className="text-sm text-casino-muted">Confirm your email address for this account.</p>
      ) : (
        <p className="text-sm text-casino-muted">Use the link from your verification email.</p>
      )}
      {err && (
        <p className="rounded-casino-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      )}
      <button
        type="button"
        disabled={loading || !token}
        className="w-full rounded-casino-md bg-casino-primary py-2.5 text-sm font-medium text-casino-bg disabled:opacity-50"
        onClick={() => void verify()}
      >
        {loading ? 'Verifying…' : 'Verify email'}
      </button>
      <Link className="text-sm text-casino-primary hover:underline" to="/?auth=login">
        Sign in
      </Link>
    </div>
  )
}
