import { useCallback, useEffect, useState } from 'react'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { formatRelativeTime } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type CredRow = {
  credential_id_hex: string
  created_at: string
}

export default function WebAuthnSecurityPage() {
  const { apiFetch } = useAdminAuth()
  const [creds, setCreds] = useState<CredRow[]>([])
  const [loading, setLoading] = useState(true)
  const [registerBusy, setRegisterBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/auth/webauthn/credentials')
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        setCreds([])
        return
      }
      const j = (await res.json()) as { credentials?: CredRow[] }
      setCreds(Array.isArray(j.credentials) ? j.credentials : [])
    } catch {
      setErr('Network error')
      setCreds([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const registerPasskey = async () => {
    setRegisterBusy(true)
    setErr(null)
    try {
      const begin = await apiFetch('/v1/admin/auth/webauthn/register/begin', { method: 'POST' })
      if (!begin.ok) {
        const t = await begin.text()
        toast.error(`Begin failed (${begin.status})${t ? `: ${t.slice(0, 120)}` : ''}`)
        return
      }
      const j = (await begin.json()) as {
        session_key?: string
        options?: Record<string, unknown>
      }
      if (!j.session_key || !j.options) {
        toast.error('Invalid register/begin response')
        return
      }
      const { startRegistration } = await import('@simplewebauthn/browser')
      let regResp: unknown
      try {
        regResp = await startRegistration({
          optionsJSON: j.options as unknown as PublicKeyCredentialCreationOptionsJSON,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Registration cancelled'
        toast.error(msg)
        return
      }
      const fin = await apiFetch('/v1/admin/auth/webauthn/register/finish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-WebAuthn-Session-Key': j.session_key,
        },
        body: JSON.stringify(regResp),
      })
      if (!fin.ok) {
        toast.error(`Finish failed (${fin.status})`)
        return
      }
      toast.success('Security key registered')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setRegisterBusy(false)
    }
  }

  return (
    <>
      <PageMeta title="Security keys · Admin" description="WebAuthn passkeys for staff MFA" />
      <PageBreadcrumb
        pageTitle="Security keys"
        subtitle="Register passkeys for this account. Superadmins can require WebAuthn MFA per staff user under Staff users."
      />

      <ComponentCard
        className="mb-6"
        title="Add a passkey"
        desc="Use a built-in platform authenticator (Windows Hello, Touch ID) or a hardware key. Required when MFA enforcement is on for your account."
      >
        {err ? <div className="alert alert-danger small py-2 mb-3">{err}</div> : null}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={registerBusy}
          onClick={() => void registerPasskey()}
        >
          {registerBusy ? 'Registering…' : 'Register new passkey'}
        </button>
      </ComponentCard>

      <ComponentCard title="Registered passkeys" desc="Credential ids stored for your staff user.">
        {loading ? (
          <p className="text-secondary small mb-0">Loading…</p>
        ) : creds.length === 0 ? (
          <p className="text-secondary small mb-0">No passkeys yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th className="small">Credential id (hex)</th>
                  <th className="small">Created</th>
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.credential_id_hex}>
                    <td className="font-monospace small text-break">{c.credential_id_hex}</td>
                    <td className="text-secondary text-nowrap small" title={c.created_at}>
                      {formatRelativeTime(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ComponentCard>
    </>
  )
}
