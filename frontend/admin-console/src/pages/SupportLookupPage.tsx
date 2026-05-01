import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { OpsToolbar } from '../components/ops'

export default function SupportLookupPage() {
  const { apiFetch } = useAdminAuth()
  const [id, setId] = useState('')
  const [idemKey, setIdemKey] = useState('')
  const [idemTrace, setIdemTrace] = useState<unknown>(null)
  const [idemLoading, setIdemLoading] = useState(false)
  const navigate = useNavigate()

  return (
    <>
      <PageMeta title="Player lookup · Admin" description="Open a player support record" />
      <PageBreadcrumb
        pageTitle="Player lookup"
        subtitle="Jump to a profile by user UUID (from All players or support tools)"
      />

      <OpsToolbar
        title="Support"
        subtitle="Deep-link to a player profile for CRM and compliance workflows."
        actions={
          <>
            <Link to="/global-chat" className="btn btn-sm btn-outline-secondary">
              Global chat
            </Link>
            <Link to="/audit-log" className="btn btn-sm btn-outline-secondary">
              Audit log
            </Link>
          </>
        }
      />

      <ComponentCard title="Find player" desc="Paste a full user id, then open the support profile.">
        <form
          className="row g-3 align-items-end"
          onSubmit={(e) => {
            e.preventDefault()
            const u = id.trim()
            if (!u) return
            navigate(`/support/player/${encodeURIComponent(u)}`)
          }}
        >
          <div className="col-md-8">
            <label htmlFor="support-user-id" className="form-label small mb-1">
              User ID
            </label>
            <input
              id="support-user-id"
              className="form-control font-monospace"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoComplete="off"
            />
          </div>
          <div className="col-md-4 d-flex gap-2">
            <button type="submit" className="btn btn-primary">
              Open profile
            </button>
            <Link to="/users" className="btn btn-outline-secondary">
              All players
            </Link>
          </div>
        </form>
      </ComponentCard>

      <ComponentCard
        title="VIP idempotency trace"
        desc="Resolve bonus:hunt:…, vip:tier_up:…, or batch keys across bonus instances, tier grant log, and delivery items."
        className="mt-4"
      >
        <form
          className="row g-3 align-items-end"
          onSubmit={(e) => {
            e.preventDefault()
            const q = idemKey.trim()
            if (!q) return
            setIdemLoading(true)
            void (async () => {
              try {
                const res = await apiFetch(`/v1/admin/vip/support/trace?q=${encodeURIComponent(q)}`)
                setIdemTrace(await res.json())
              } finally {
                setIdemLoading(false)
              }
            })()
          }}
        >
          <div className="col-md-10">
            <label htmlFor="idem-key" className="form-label small mb-1">
              Idempotency key
            </label>
            <input
              id="idem-key"
              className="form-control font-monospace small"
              value={idemKey}
              onChange={(e) => setIdemKey(e.target.value)}
              placeholder="bonus:hunt:…"
              autoComplete="off"
            />
          </div>
          <div className="col-md-2">
            <button type="submit" className="btn btn-secondary w-100" disabled={idemLoading}>
              {idemLoading ? '…' : 'Trace'}
            </button>
          </div>
        </form>
        {idemTrace != null ? (
          <pre className="mt-3 mb-0 small bg-dark text-light p-3 rounded overflow-auto" style={{ maxHeight: 280 }}>
            {JSON.stringify(idemTrace, null, 2)}
          </pre>
        ) : null}
      </ComponentCard>
    </>
  )
}
