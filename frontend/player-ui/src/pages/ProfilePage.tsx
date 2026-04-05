import { useCallback, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'

const supportUrl = import.meta.env.VITE_SUPPORT_URL as string | undefined
const rgUrl = import.meta.env.VITE_RG_URL as string | undefined

export default function ProfilePage() {
  const { accessToken, me, balanceMinor, refreshProfile, logout, apiFetch } = usePlayerAuth()
  const [copied, setCopied] = useState(false)
  const [resendMsg, setResendMsg] = useState<string | null>(null)

  const copyId = useCallback(() => {
    if (!me?.id) return
    void navigator.clipboard.writeText(me.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [me])

  const resend = useCallback(async () => {
    setResendMsg(null)
    try {
      const res = await apiFetch('/v1/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const p = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(p, res.status, 'POST /v1/auth/verify-email/resend', rid)
        setResendMsg(p?.message ?? 'Could not send email')
        return
      }
      setResendMsg('Check your inbox for a new verification link.')
      void refreshProfile()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/auth/verify-email/resend')
      setResendMsg('Network error.')
    }
  }, [apiFetch, refreshProfile])

  if (!accessToken) return <Navigate to="/?auth=login" replace />

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-casino-primary">Your profile</h1>
        <Link to="/" className="text-sm text-casino-muted hover:text-casino-primary">
          ← Games
        </Link>
      </div>

      <div className="space-y-3 rounded-casino-lg border border-casino-border bg-casino-surface p-4 text-sm">
        <div>
          <div className="text-xs text-casino-muted">Email</div>
          <div className="font-medium text-casino-foreground">{me?.email ?? '…'}</div>
        </div>
        <div>
          <div className="text-xs text-casino-muted">Member since</div>
          <div className="text-casino-foreground">
            {me?.created_at
              ? new Date(me.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-casino-muted">Email verified</div>
          <div className="text-casino-foreground">
            {me?.email_verified ? 'Yes' : 'No — verify to deposit or withdraw'}
          </div>
        </div>
        {!me?.email_verified && (
          <button
            type="button"
            className="text-sm text-casino-primary underline"
            onClick={() => void resend()}
          >
            Resend verification email
          </button>
        )}
        {resendMsg && <p className="text-xs text-casino-muted">{resendMsg}</p>}
        <div>
          <div className="text-xs text-casino-muted">Balance (minor units)</div>
          <div className="text-casino-primary">{balanceMinor ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-casino-muted">User ID (for support)</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all text-xs text-casino-foreground">{me?.id ?? '—'}</code>
            <button
              type="button"
              className="rounded-casino-sm border border-casino-border px-2 py-1 text-xs"
              onClick={copyId}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        {supportUrl ? (
          <a
            href={supportUrl}
            target="_blank"
            rel="noreferrer"
            className="text-casino-primary hover:underline"
          >
            Help & support
          </a>
        ) : (
          <span className="text-casino-muted">Help & support — set VITE_SUPPORT_URL</span>
        )}
        {rgUrl ? (
          <a
            href={rgUrl}
            target="_blank"
            rel="noreferrer"
            className="text-casino-primary hover:underline"
          >
            Responsible gambling resources
          </a>
        ) : (
          <span className="text-casino-muted">
            Responsible gambling — set VITE_RG_URL for your jurisdiction
          </span>
        )}
      </div>

      <button
        type="button"
        className="w-full rounded-casino-md border border-casino-border py-2 text-sm text-casino-muted hover:bg-casino-elevated"
        onClick={() => void logout()}
      >
        Sign out
      </button>
    </div>
  )
}
