import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type Summary = Record<string, unknown>

type PaymentFlags = {
  deposits_enabled: boolean
  withdrawals_enabled: boolean
  real_play_enabled: boolean
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

  const isSuper = role === 'superadmin'

  return (
    <>
      <PageMeta title="Payments ops · Admin" description="Fystack pipeline health" />
      <PageBreadcrumb pageTitle="Payments ops" />
      <ComponentCard title="Pipeline summary" desc="Webhook backlog, wallets, and queue depth.">
        {err ? <p className="text-sm text-red-500">{err}</p> : null}
        {summary ? (
          <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {Object.entries(summary).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono text-xs text-brand-600 dark:text-brand-400">{k}</span>:{' '}
                {String(v)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No summary loaded.</p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void load()}
          >
            Refresh
          </button>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Auto-refresh every 10s
          </span>
        </div>
      </ComponentCard>

      <ComponentCard
        title="On-chain deposit asset keys"
        desc="Which FYSTACK_DEPOSIT_ASSETS_JSON / legacy deposit asset slots are set (booleans only)."
      >
        {depositAssets?.configured ? (
          <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {Object.entries(depositAssets.configured).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono text-xs text-brand-600 dark:text-brand-400">{k}</span>: {v ? 'yes' : 'no'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Could not load deposit-asset config snapshot.</p>
        )}
      </ComponentCard>

      <ComponentCard title="Payment flags" desc="Deposits, withdrawals, and real play (Blue Ocean real mode).">
        {flags ? (
          <ul className="text-sm text-gray-700 dark:text-gray-300">
            <li>deposits_enabled: {String(flags.deposits_enabled)}</li>
            <li>withdrawals_enabled: {String(flags.withdrawals_enabled)}</li>
            <li>real_play_enabled: {String(flags.real_play_enabled)}</li>
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Flags unavailable.</p>
        )}
        {isSuper ? (
          <p className="mt-2 text-xs text-gray-500">
            Superadmin: use PATCH /v1/admin/ops/payment-flags with JSON toggles to change flags (audited).
          </p>
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
