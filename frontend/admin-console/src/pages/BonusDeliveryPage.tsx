import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type VersionRow = {
  id: number
  version: number
  published: boolean
  created_at: string
  valid_from?: string
  valid_to?: string
}

type PaymentFlags = {
  bonuses_enabled?: boolean
  automated_grants_enabled?: boolean
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** Convert ISO string to value for datetime-local input (local timezone). */
function isoToLocalDatetimeValue(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function localDatetimeValueToIso(v: string): string | null {
  if (!v.trim()) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

const btnPrimary =
  'rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50'
const btnSecondary =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-white/10'

export default function BonusDeliveryPage() {
  const { id: idParam } = useParams()
  const promoId = idParam ? parseInt(idParam, 10) : NaN
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [status, setStatus] = useState('')
  const [grantsPaused, setGrantsPaused] = useState(false)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [flags, setFlags] = useState<PaymentFlags | null>(null)

  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [noEnd, setNoEnd] = useState(true)

  const [busy, setBusy] = useState<string | null>(null)

  const latest = versions[0] ?? null

  const load = useCallback(async () => {
    if (!Number.isFinite(promoId) || promoId <= 0) {
      setErr('Invalid promotion id')
      setLoading(false)
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const [res, flagsRes] = await Promise.all([
        apiFetch(`/v1/admin/bonushub/promotions/${promoId}`),
        apiFetch('/v1/admin/ops/payment-flags'),
      ])
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Load failed (${res.status})`))
        setVersions([])
        return
      }
      const j = (await res.json()) as {
        name?: string
        slug?: string
        status?: string
        grants_paused?: boolean
        versions?: VersionRow[]
      }
      setName(j.name ?? '')
      setSlug(j.slug ?? '')
      setStatus((j.status ?? '').toLowerCase())
      setGrantsPaused(!!j.grants_paused)
      const vers = Array.isArray(j.versions) ? j.versions : []
      setVersions(vers)
      const lv = vers[0]
      if (lv) {
        setStartLocal(isoToLocalDatetimeValue(lv.valid_from))
        if (lv.valid_to) {
          setNoEnd(false)
          setEndLocal(isoToLocalDatetimeValue(lv.valid_to))
        } else {
          setNoEnd(true)
          setEndLocal('')
        }
      }

      if (flagsRes.ok) {
        const fj = (await flagsRes.json()) as PaymentFlags
        setFlags(fj)
      } else {
        setFlags(null)
      }
    } catch {
      setErr('Network error')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, promoId])

  useEffect(() => {
    void load()
  }, [load])

  const derivedStatus = useMemo(() => {
    if (status === 'archived') return 'archived' as const
    if (!latest?.published) return 'draft' as const
    if (grantsPaused) return 'paused' as const
    const globalsOk =
      (flags?.bonuses_enabled !== false && flags?.automated_grants_enabled !== false) || flags == null
    if (!globalsOk) return 'blocked' as const
    return 'active' as const
  }, [status, latest, grantsPaused, flags])

  const saveSchedule = async () => {
    if (!latest || !isSuper) return
    const vf = localDatetimeValueToIso(startLocal)
    const vt = noEnd ? '' : localDatetimeValueToIso(endLocal)
    if (startLocal.trim() && !vf) {
      setErr('Start date is invalid')
      return
    }
    if (!noEnd && endLocal.trim() && !vt) {
      setErr('End date is invalid')
      return
    }
    setBusy('schedule')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${latest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valid_from: vf ?? '',
          valid_to: noEnd ? '' : vt ?? '',
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Save schedule failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    if (!latest || latest.published) return
    setBusy('publish')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${latest.id}/publish`, {
        method: 'POST',
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Publish failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const setPaused = async (paused: boolean) => {
    if (!isSuper) return
    setBusy('pause')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grants_paused: paused }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Update failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const setArchived = async (archived: boolean) => {
    if (!isSuper) return
    setBusy('arch')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: archived ? 'archived' : 'draft' }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Update failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  if (!Number.isFinite(promoId) || promoId <= 0) {
    return (
      <p className="text-sm text-red-600">
        Invalid promotion. <Link to="/bonushub">Back to catalog</Link>
      </p>
    )
  }

  const statusBadgeClass =
    derivedStatus === 'active'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
      : derivedStatus === 'paused'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
        : derivedStatus === 'archived'
          ? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
          : derivedStatus === 'draft'
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200'
            : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'

  const statusLabel =
    derivedStatus === 'active'
      ? 'Live'
      : derivedStatus === 'paused'
        ? 'Paused'
        : derivedStatus === 'draft'
          ? 'Draft'
          : derivedStatus === 'archived'
            ? 'Archived'
            : 'Blocked'

  return (
    <>
      <PageMeta
        title="Bonus Engine · Schedule & deliver"
        description="Publish, schedule, and pause this promotion."
      />

      {err ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Schedule &amp; deliver
            </p>
            <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{name || 'Promotion'}</h2>
                <p className="mt-0.5 font-mono text-sm text-gray-500 dark:text-gray-400">
                  {slug} · ID {promoId}
                </p>
                <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass}`}>
                  {statusLabel}
                  {derivedStatus === 'active' ? ' · grants on' : null}
                  {derivedStatus === 'paused' ? ' · grants paused' : null}
                  {derivedStatus === 'blocked' ? ' · toggles off' : null}
                </span>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {latest && status !== 'archived' && !latest.published ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!isSuper || busy !== null}
                    onClick={() => void publish()}
                  >
                    {busy === 'publish' ? 'Publishing…' : `Publish version ${latest.version}`}
                  </button>
                ) : null}
                {latest && status !== 'archived' && latest.published && grantsPaused ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!isSuper || busy !== null}
                    onClick={() => void setPaused(false)}
                  >
                    {busy === 'pause' ? '…' : 'Resume grants'}
                  </button>
                ) : null}
                {derivedStatus === 'blocked' ? (
                  <Link to="/finance" className={`text-center ${btnPrimary}`}>
                    Review payment toggles
                  </Link>
                ) : null}
                {status === 'archived' ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!isSuper || busy !== null}
                    onClick={() => void setArchived(false)}
                  >
                    {busy === 'arch' ? '…' : 'Restore from archive'}
                  </button>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2 dark:border-gray-700 sm:border-0 sm:pt-0">
                  {latest && status !== 'archived' && latest.published && !grantsPaused ? (
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={!isSuper || busy !== null}
                      onClick={() => void setPaused(true)}
                    >
                      {busy === 'pause' ? '…' : 'Pause grants'}
                    </button>
                  ) : null}
                  {latest && status !== 'archived' ? (
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      disabled={!isSuper || busy !== null}
                      onClick={() => void setArchived(true)}
                    >
                      {busy === 'arch' ? '…' : 'Archive'}
                    </button>
                  ) : null}
                  <Link to={`/bonushub/promotions/${promoId}/rules`} className={btnSecondary}>
                    Edit rules
                  </Link>
                  <Link to={`/bonushub/operations?tab=promotions&promo=${promoId}`} className={btnSecondary}>
                    Operations
                  </Link>
                  <Link to="/bonushub/calendar" className={btnSecondary}>
                    Calendar
                  </Link>
                  <Link to="/bonushub" className={btnSecondary}>
                    Promotions
                  </Link>
                </div>
              </div>
            </div>

            {flags && (flags.bonuses_enabled === false || flags.automated_grants_enabled === false) ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Platform toggles: bonuses {flags.bonuses_enabled === false ? 'OFF' : 'ON'}, automated grants{' '}
                {flags.automated_grants_enabled === false ? 'OFF' : 'ON'}. Adjust in{' '}
                <Link to="/finance" className="font-medium underline">
                  Finance
                </Link>{' '}
                or Settings (superadmin).
              </div>
            ) : null}

            {!isSuper ? (
              <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
                Superadmin required to publish, edit schedule, pause, or archive.
              </p>
            ) : null}
          </div>

          <details className="mb-6 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/30">
            <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
              Before you go live
            </summary>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
              <li>Publish a version so it has a published timestamp.</li>
              <li>Optional schedule: grant window must include deposit time.</li>
              <li>Bonuses and automated grants toggles ON (Finance or Settings).</li>
              <li>
                Worker + Redis for deposit automation — see Bonus Engine header <strong>Setup hint</strong>.
              </li>
              <li>Verify in player Profile → Bonuses or Operations → simulate (superadmin).</li>
            </ul>
          </details>

          {latest ? (
            <ComponentCard
              title="Schedule"
              desc="Grant window (local time). Deposits match only while inside this window and rules allow."
            >
              <div className="grid max-w-xl gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Starts (local time)
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    disabled={!isSuper || busy !== null}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                    <input
                      type="checkbox"
                      checked={noEnd}
                      onChange={(e) => {
                        setNoEnd(e.target.checked)
                        if (e.target.checked) setEndLocal('')
                      }}
                      disabled={!isSuper || busy !== null}
                    />
                    No end date
                  </label>
                  {!noEnd ? (
                    <>
                      <span className="mb-1 mt-2 block text-xs font-medium text-gray-600 dark:text-gray-400">
                        Ends (local time)
                      </span>
                      <input
                        type="datetime-local"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        value={endLocal}
                        onChange={(e) => setEndLocal(e.target.value)}
                        disabled={!isSuper || busy !== null}
                      />
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className={`mt-4 ${btnPrimary}`}
                disabled={!isSuper || busy !== null}
                onClick={() => void saveSchedule()}
              >
                {busy === 'schedule' ? 'Saving…' : 'Save schedule'}
              </button>
              {latest.published ? (
                <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
                  Version {latest.version} is published.
                </p>
              ) : null}
            </ComponentCard>
          ) : (
            <p className="text-sm text-gray-500">No versions found for this promotion.</p>
          )}
        </>
      )}
    </>
  )
}
