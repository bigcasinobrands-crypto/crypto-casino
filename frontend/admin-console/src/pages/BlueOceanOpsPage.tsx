import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import AdminDataTable from '../components/admin/AdminDataTable'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import { DefinitionTable, definitionValueBoolean, OpsToolbar } from '../components/ops'
import { StatCard } from '../components/dashboard'
import { formatRelativeTime } from '../lib/format'
import { humanFieldLabel } from '../lib/adminFormatting'

type Tab = 'status' | 'events'

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

export default function BlueOceanOpsPage() {
  const { apiFetch } = useAdminAuth()
  const { reportApiFailure, reportNetworkFailure } = useAdminActivityLog()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: Tab = tabParam === 'events' ? 'events' : 'status'

  const setTab = (t: Tab) => {
    setSearchParams(t === 'status' ? {} : { tab: t }, { replace: true })
  }

  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [flags, setFlags] = useState<Record<string, unknown> | null>(null)
  const [syncMsg, setSyncMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    const pathS = '/v1/admin/integrations/blueocean/status'
    const pathF = '/v1/admin/system/operational-flags'
    const [s, f] = await Promise.all([apiFetch(pathS), apiFetch(pathF)])
    if (s.ok) setStatus((await s.json()) as Record<string, unknown>)
    else {
      const parsed = await readApiError(s)
      reportApiFailure({ res: s, parsed, method: 'GET', path: pathS })
      setStatus(null)
    }
    if (f.ok) setFlags((await f.json()) as Record<string, unknown>)
    else {
      const parsed = await readApiError(f)
      reportApiFailure({ res: f, parsed, method: 'GET', path: pathF })
      setFlags(null)
    }
    setLoadedAt(new Date().toISOString())
  }, [apiFetch, reportApiFailure])

  useEffect(() => {
    void load()
  }, [load])

  const sync = async () => {
    setBusy(true)
    setSyncMsg(null)
    const syncPath = '/v1/admin/integrations/blueocean/sync-catalog'
    try {
      const res = await apiFetch(syncPath, {
        method: 'POST',
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'POST', path: syncPath })
        const msg = `Sync failed (HTTP ${res.status}).`
        setSyncMsg({ kind: 'err', text: msg })
        toast.error(msg)
        return
      }
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const okText = `Catalog sync OK — upserted ${String(j.upserted ?? '?')} game(s).`
      setSyncMsg({ kind: 'ok', text: okText })
      toast.success('Catalog sync completed')
    } catch {
      reportNetworkFailure({
        message: 'Network error during sync.',
        method: 'POST',
        path: syncPath,
      })
      const msg = 'Network error during sync.'
      setSyncMsg({ kind: 'err', text: msg })
      toast.error(msg)
    } finally {
      setBusy(false)
      void load()
    }
  }

  const connected = status ? pickBool(status, 'bog_configured') : undefined
  const lastErr = status ? pickStr(status, 'last_sync_error') : undefined
  const gamesSynced = status ? pickNum(status, 'last_sync_upserted') : undefined
  const lastAt = status ? pickStr(status, 'last_sync_at') : undefined
  const syncCcy = status ? pickStr(status, 'last_sync_currency') : undefined

  const statusRows = useMemo(() => {
    if (!status) return []
    const rows: { field: string; value: ReactNode; mono?: boolean }[] = []
    const bog = pickBool(status, 'bog_configured')
    if (bog !== undefined) {
      rows.push({
        field: humanFieldLabel('bog_configured'),
        value: definitionValueBoolean(bog, 'Configured', 'Not configured'),
      })
    }
    if (syncCcy) rows.push({ field: humanFieldLabel('last_sync_currency'), value: syncCcy })
    if (gamesSynced !== undefined)
      rows.push({ field: humanFieldLabel('last_sync_upserted'), value: String(gamesSynced) })
    if (lastAt)
      rows.push({
        field: humanFieldLabel('last_sync_at'),
        value: (
          <span>
            {formatRelativeTime(lastAt)}{' '}
            <span className="text-secondary">({lastAt})</span>
          </span>
        ),
        mono: true,
      })
    if (lastErr)
      rows.push({
        field: humanFieldLabel('last_sync_error'),
        value: <span className="text-danger">{lastErr}</span>,
        mono: true,
      })
    return rows
  }, [status, syncCcy, gamesSynced, lastAt, lastErr])

  const flagsRows = useMemo(() => {
    if (!flags) return []
    const rows: { field: string; value: ReactNode; mono?: boolean }[] = []
    for (const [k, v] of Object.entries(flags)) {
      let value: ReactNode = String(v)
      if (typeof v === 'boolean') value = definitionValueBoolean(v)
      rows.push({
        field: humanFieldLabel(k),
        value,
        mono: typeof v === 'number',
      })
    }
    return rows
  }, [flags])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'status', label: 'Status' },
    { id: 'events', label: 'Events' },
  ]

  const warnZeroGames =
    connected === true && gamesSynced === 0 && !lastErr && lastAt !== undefined

  return (
    <>
      <PageMeta title="Provider Operations · Admin" description="Integration status, catalog sync, and event log" />
      <PageBreadcrumb
        pageTitle="Provider operations"
        subtitle="BlueOcean integration health, catalog sync, and live event stream."
      />

      <OpsToolbar
        subtitle={loadedAt ? `Last refreshed ${formatRelativeTime(loadedAt)}` : undefined}
        actions={
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void load()}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden />
            Refresh
          </button>
        }
      />

      <div className="btn-group mb-3" role="group" aria-label="Provider ops section">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-outline-secondary'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'status' && (
        <>
          <div className="row g-3 mb-3">
            <div className="col-6 col-lg-3">
              <StatCard
                label="BlueOcean configured"
                value={connected === undefined ? '—' : connected ? 'Yes' : 'No'}
                variant={connected ? 'success' : 'secondary'}
                iconClass={connected ? 'bi-plug' : 'bi-plug-fill'}
              />
            </div>
            <div className="col-6 col-lg-3">
              <StatCard
                label="Games last synced"
                value={gamesSynced === undefined ? '—' : String(gamesSynced)}
                variant={gamesSynced && gamesSynced > 0 ? 'info' : 'warning'}
                iconClass="bi-controller"
              />
            </div>
            <div className="col-6 col-lg-3">
              <StatCard
                label="Last catalog sync"
                value={lastAt ? formatRelativeTime(lastAt) : '—'}
                variant="primary"
                iconClass="bi-clock-history"
              />
            </div>
            <div className="col-6 col-lg-3">
              <StatCard
                label="Sync health"
                value={lastErr ? 'Error' : warnZeroGames ? 'Check catalog' : 'OK'}
                variant={lastErr ? 'danger' : warnZeroGames ? 'warning' : 'success'}
                iconClass={lastErr ? 'bi-exclamation-triangle' : 'bi-heart-pulse'}
              />
            </div>
          </div>

          {lastErr ? (
            <div className="alert alert-danger small py-2 mb-3">
              <strong>Last sync error.</strong> {lastErr} — verify API credentials and provider response shape on the
              core service.
            </div>
          ) : null}
          {warnZeroGames ? (
            <div className="alert alert-warning small py-2 mb-3">
              Catalog reports <strong>0</strong> games after a sync. Common causes: empty provider response, wrong
              credentials, or currency mismatch. Check core logs and BlueOcean API configuration.
            </div>
          ) : null}

          <div className="d-flex flex-column gap-3">
            <ComponentCard
              title="Catalog sync"
              desc="POST /v1/admin/integrations/blueocean/sync-catalog"
              iconClass="bi-cloud-arrow-down"
              tone={lastErr ? 'warning' : 'default'}
            >
              <p className="text-secondary small mb-3">
                Pulls the remote game list and upserts into the local catalog. Requires API credentials on the core
                service.
              </p>
              <button type="button" disabled={busy} onClick={() => void sync()} className="btn btn-primary btn-sm">
                {busy ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" aria-hidden />
                    Syncing…
                  </>
                ) : (
                  <>
                    <i className="bi bi-arrow-repeat me-1" aria-hidden />
                    Sync catalog now
                  </>
                )}
              </button>
              {syncMsg ? (
                <div
                  className={`alert small py-2 mt-3 mb-0 ${syncMsg.kind === 'ok' ? 'alert-success' : 'alert-danger'}`}
                >
                  {syncMsg.text}
                </div>
              ) : null}
            </ComponentCard>

            <ComponentCard title="Integration status" desc="Connection and last catalog sync." iconClass="bi-activity">
              {statusRows.length > 0 ? (
                <DefinitionTable rows={statusRows} flush />
              ) : (
                <p className="text-secondary small mb-0">Loading…</p>
              )}
              {status ? (
                <details className="mt-3 mb-0">
                  <summary className="small text-primary" role="button">
                    Technical details (full payload)
                  </summary>
                  <div className="mt-2">
                    <ApiResultSummary data={status} embedded />
                  </div>
                </details>
              ) : null}
            </ComponentCard>

            <ComponentCard
              title="Operational flags"
              desc="System-wide switches from this API process (see Settings for editable site flags where applicable)."
              iconClass="bi-sliders"
              headerActions={
                <Link to="/settings?tab=system" className="btn btn-outline-secondary btn-sm">
                  Open settings
                </Link>
              }
            >
              {flagsRows.length > 0 ? (
                <DefinitionTable rows={flagsRows} flush />
              ) : (
                <p className="text-secondary small mb-0">Loading…</p>
              )}
              {flags ? (
                <details className="mt-3 mb-0">
                  <summary className="small text-primary" role="button">
                    Technical details (full payload)
                  </summary>
                  <div className="mt-2">
                    <ApiResultSummary data={flags} embedded />
                  </div>
                </details>
              ) : null}
            </ComponentCard>
          </div>
        </>
      )}

      {activeTab === 'events' && (
        <ComponentCard title="BlueOcean events" desc="Recent integration events from the provider." iconClass="bi-lightning">
          <div className="table-responsive">
            <AdminDataTable
              apiPath="/v1/admin/events/blueocean"
              apiFetch={apiFetch}
              refreshIntervalMs={15000}
            />
          </div>
        </ComponentCard>
      )}
    </>
  )
}
