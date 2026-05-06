import { useCallback, useEffect, useMemo, useState } from 'react'
import { readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { DefinitionTable } from '../components/ops'
import { StatCard } from '../components/dashboard'
import { formatRelativeTime } from '../lib/format'

function pickStr(m: Record<string, unknown>, k: string): string | undefined {
  const v = m[k]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function pickBool(m: Record<string, unknown>, k: string): boolean | undefined {
  const v = m[k]
  if (typeof v === 'boolean') return v
  return undefined
}

function pickNum(m: Record<string, unknown>, k: string): number | undefined {
  const v = m[k]
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  return undefined
}

export default function OddinIntegrationPage() {
  const { apiFetch } = useAdminAuth()
  const { reportApiFailure } = useAdminActivityLog()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  const path = '/v1/admin/integrations/oddin'

  const load = useCallback(async () => {
    const res = await apiFetch(path)
    if (res.ok) {
      setData((await res.json()) as Record<string, unknown>)
      setLoadedAt(new Date().toISOString())
    } else {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path })
      setData(null)
      setLoadedAt(new Date().toISOString())
    }
  }, [apiFetch, reportApiFailure])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    if (!data) return []
    const r: { field: string; value: string }[] = []
    const push = (field: string, value: string) => r.push({ field, value })

    const en = pickBool(data, 'enabled')
    if (en !== undefined) push('Integration enabled', en ? 'Yes' : 'No')

    const env = pickStr(data, 'environment')
    if (env) push('Environment', env)

    const bu = pickStr(data, 'base_url')
    if (bu) push('Base URL', bu)

    const su = pickStr(data, 'script_url')
    if (su) push('Script URL', su)

    const btc = pickBool(data, 'brand_token_configured')
    if (btc !== undefined) push('Brand token configured', btc ? 'Yes' : 'No')

    const ak = pickBool(data, 'operator_api_key_configured')
    if (ak !== undefined) push('Operator API key configured', ak ? 'Yes' : 'No')

    const hs = pickBool(data, 'hash_secret_configured')
    if (hs !== undefined) push('Hash secret configured', hs ? 'Yes' : 'No')

    const ll = pickStr(data, 'last_iframe_loaded_at')
    if (ll) push('Last iframe LOADED', ll)

    const le = pickStr(data, 'last_iframe_error_at')
    if (le) push('Last iframe ERROR', le)

    const pv = pickNum(data, 'iframe_loaded_events')
    if (pv !== undefined) push('LOADED events (views)', String(pv))

    const rs = pickNum(data, 'request_sign_in_events')
    if (rs !== undefined) push('REQUEST_SIGN_IN events', String(rs))

    const rr = pickNum(data, 'request_refresh_balance_events')
    if (rr !== undefined) push('REQUEST_REFRESH_BALANCE events', String(rr))

    const an = pickNum(data, 'analytics_events')
    if (an !== undefined) push('ANALYTICS events', String(an))

    const oe = pickNum(data, 'operator_endpoint_errors')
    if (oe !== undefined) push('Operator callback errors (audit)', String(oe))

    const enc = pickBool(data, 'esports_nav_configured')
    if (enc !== undefined) push('E-Sports nav (operator JSON)', enc ? 'Yes' : 'No')

    return r
  }, [data])

  const enabled = pickBool(data ?? {}, 'enabled')

  return (
    <>
      <PageMeta title="Oddin Bifrost · Admin" description="Esports iframe integration diagnostics (non-secret)" />
      <PageBreadcrumb
        pageTitle="Oddin Bifrost"
        subtitle="Health and event counters for the player sportsbook iframe (GET /v1/admin/integrations/oddin)."
      />

      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <StatCard
            label="Status"
            value={enabled === undefined ? '—' : enabled ? 'Enabled' : 'Disabled'}
            variant={enabled ? 'success' : 'secondary'}
          />
        </div>
        <div className="col-md-4">
          <StatCard label="Environment" value={pickStr(data ?? {}, 'environment') ?? '—'} variant="info" />
        </div>
        <div className="col-md-4">
          <StatCard
            label="Operator errors"
            value={String(pickNum(data ?? {}, 'operator_endpoint_errors') ?? '—')}
            variant="warning"
          />
        </div>
      </div>

      <ComponentCard
        title="Integration status"
        desc={loadedAt ? `Last refreshed ${formatRelativeTime(loadedAt)}` : undefined}
        headerActions={
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void load()}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden />
            Refresh
          </button>
        }
      >
        {!data ? (
          <p className="text-secondary small mb-0">Could not load Oddin status (check admin auth and API).</p>
        ) : (
          <DefinitionTable flush rows={rows.map((x) => ({ field: x.field, value: x.value, mono: true }))} />
        )}
      </ComponentCard>
    </>
  )
}
