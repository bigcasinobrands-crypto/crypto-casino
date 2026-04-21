import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { StatCard, StatusBadge } from '../components/dashboard'
import { useDashboardKPIs } from '../hooks/useDashboard'
import { formatCurrency, formatCompact } from '../lib/format'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import { AdminSection } from '../components/admin-ui'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { Toggle } from '../components/common/Toggle'

type Summary = Record<string, unknown>

type PaymentFlags = {
  deposits_enabled: boolean
  withdrawals_enabled: boolean
  real_play_enabled: boolean
  bonuses_enabled?: boolean
  automated_grants_enabled?: boolean
}

type DepositAssetsPayload = {
  configured?: Record<string, boolean>
}

export default function PaymentOpsPage() {
  const { apiFetch, role } = useAdminAuth()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [flags, setFlags] = useState<PaymentFlags | null>(null)
  const [depositAssets, setDepositAssets] = useState<DepositAssetsPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flagBusyKey, setFlagBusyKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [sRes, fRes, dRes] = await Promise.all([
        apiFetch('/v1/admin/ops/summary'),
        apiFetch('/v1/admin/ops/payment-flags'),
        apiFetch('/v1/admin/ops/deposit-assets'),
      ])
      if (sRes.ok) {
        setSummary((await sRes.json()) as Summary)
      } else {
        setSummary(null)
      }
      if (fRes.ok) {
        setFlags((await fRes.json()) as PaymentFlags)
      } else {
        setFlags(null)
      }
      if (dRes.ok) {
        setDepositAssets((await dRes.json()) as DepositAssetsPayload)
      } else {
        setDepositAssets(null)
      }
    } catch {
      setErr('Failed to load ops data')
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh ops data every 10s
  useEffect(() => {
    const t = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(t)
  }, [load])

  const isSuper = role === 'superadmin'

  const togglePaymentFlag = async (key: string, current: boolean) => {
    if (!isSuper) {
      toast.error('Superadmin required to change payment flags')
      return
    }
    setFlagBusyKey(key)
    try {
      const res = await apiFetch('/v1/admin/ops/payment-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !current }),
      })
      if (!res.ok) {
        toast.error('Could not update payment flag')
        return
      }
      toast.success(`Updated ${key.replace(/_/g, ' ')}`)
      await load()
    } catch {
      toast.error('Network error updating flag')
    } finally {
      setFlagBusyKey(null)
    }
  }

  const reconcile = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/ops/reconcile-fystack', { method: 'POST' })
      if (!res.ok) {
        setErr(`Reconcile failed (${res.status})`)
        return
      }
      await load()
    } catch {
      setErr('Reconcile request failed')
    } finally {
      setBusy(false)
    }
  }

  const { data: kpis } = useDashboardKPIs()

  return (
    <>
      <PageMeta title="Finance Overview · Admin" description="Deposits, withdrawals, and pipeline health" />
      <PageBreadcrumb pageTitle="Finance Overview" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Deposit Volume (24h)"
          value={kpis ? formatCurrency(kpis.deposits_24h) : '—'}
          deltaLabel="txns"
          delta={undefined}
        />
        <StatCard
          label="Withdrawal Volume (24h)"
          value={kpis ? formatCurrency(kpis.withdrawals_24h) : '—'}
        />
        <StatCard
          label="Pending Withdrawals"
          value={kpis ? `${formatCurrency(kpis.pending_withdrawals_value)} (${formatCompact(kpis.pending_withdrawals_count)})` : '—'}
        />
        <StatCard
          label="Net Cash Flow (30d)"
          value={kpis ? formatCurrency(kpis.net_cash_flow_30d) : '—'}
          delta={kpis ? (kpis.net_cash_flow_30d >= 0 ? 0.1 : -0.1) : undefined}
        />
      </div>

      {kpis && kpis.pending_withdrawals_count > 0 && (
        <div className="mb-6">
          <Link
            to="/withdrawal-approvals"
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
              {kpis.pending_withdrawals_count}
            </span>
            Review pending withdrawal approvals
          </Link>
        </div>
      )}

      <AdminSection
        title="Pipeline summary"
        desc="Webhook backlog, wallets, worker failures, and queue depth — labeled fields below."
      >
        {err ? <p className="text-sm text-red-500">{err}</p> : null}
        {summary ? <ApiResultSummary data={summary} embedded /> : <p className="text-sm text-gray-500">No summary loaded.</p>}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void load()}
          >
            Refresh
          </button>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Auto-refresh every 10s</span>
        </div>
      </AdminSection>

      <AdminSection
        title="On-chain deposit asset keys"
        desc="Which Fystack deposit asset slots are configured in the environment (read-only snapshot)."
      >
        {depositAssets?.configured ? (
          <ApiResultSummary data={depositAssets.configured} embedded />
        ) : (
          <p className="text-sm text-gray-500">Could not load deposit-asset config snapshot.</p>
        )}
      </AdminSection>

      <ComponentCard
        title="Payment flags"
        desc="Deposits, withdrawals, real play, and bonus automation. Changes are audited."
      >
        {flags ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['deposits_enabled', flags.deposits_enabled],
                ['withdrawals_enabled', flags.withdrawals_enabled],
                ['real_play_enabled', flags.real_play_enabled],
                ['bonuses_enabled', flags.bonuses_enabled ?? true],
                ['automated_grants_enabled', flags.automated_grants_enabled ?? true],
              ] as const
            ).map(([key, val]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-white/[0.02]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    {key.replace(/_/g, ' ')}
                  </span>
                  <StatusBadge label={val ? 'ON' : 'OFF'} variant={val ? 'success' : 'error'} dot />
                </div>
                <Toggle
                  checked={!!val}
                  disabled={flagBusyKey === key || !isSuper}
                  onChange={() => void togglePaymentFlag(key, !!val)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Flags unavailable.</p>
        )}
        {!isSuper ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">Superadmin role required to edit toggles.</p>
        ) : null}
      </ComponentCard>

      {isSuper ? (
        <ComponentCard title="Reconciliation" desc="Replay stale Fystack webhook deliveries (idempotent).">
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white/10"
            onClick={() => void reconcile()}
          >
            {busy ? 'Running…' : 'Run reconcile'}
          </button>
        </ComponentCard>
      ) : null}
    </>
  )
}
