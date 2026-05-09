import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { formatCurrency } from '../lib/format'

type ReferralTierRow = {
  id: number
  name: string
  sort_order: number
  active: boolean
  ngr_revshare_bps?: number
  first_deposit_cpa_minor?: number
  deposit_revshare_bps?: number
  min_referred_signups?: number
  min_referred_depositors?: number
  min_referred_deposit_volume_minor?: number
  created_at?: string
  updated_at?: string
}

type Draft = Record<
  number,
  {
    name: string
    sort_order: string
    active: boolean
    ngr: string
    cpa: string
    depBps: string
    minSig: string
    minDep: string
    minVol: string
  }
>

function parseIntField(s: string): number | undefined {
  const t = s.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

function parseInt64Field(s: string): number | undefined {
  const t = s.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

export default function ReferralProgramTiersPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [tiers, setTiers] = useState<ReferralTierRow[]>([])
  const [draft, setDraft] = useState<Draft>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/referrals/tiers')
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        setTiers([])
        return
      }
      const j = (await res.json()) as { tiers?: ReferralTierRow[] }
      const rows = Array.isArray(j.tiers) ? j.tiers : []
      setTiers(rows)
      const d: Draft = {}
      for (const t of rows) {
        d[t.id] = {
          name: t.name,
          sort_order: String(t.sort_order),
          active: t.active,
          ngr: t.ngr_revshare_bps != null ? String(t.ngr_revshare_bps) : '',
          cpa: t.first_deposit_cpa_minor != null ? String(t.first_deposit_cpa_minor) : '',
          depBps: t.deposit_revshare_bps != null ? String(t.deposit_revshare_bps) : '',
          minSig: t.min_referred_signups != null ? String(t.min_referred_signups) : '',
          minDep: t.min_referred_depositors != null ? String(t.min_referred_depositors) : '',
          minVol: t.min_referred_deposit_volume_minor != null ? String(t.min_referred_deposit_volume_minor) : '',
        }
      }
      setDraft(d)
    } catch {
      setErr('Network error')
      setTiers([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const saveTier = async (id: number) => {
    if (!isSuper) return
    const d = draft[id]
    if (!d) return
    setBusyId(id)
    try {
      const body: Record<string, unknown> = {
        name: d.name.trim(),
        sort_order: parseIntField(d.sort_order),
        active: d.active,
      }
      const ngr = parseIntField(d.ngr)
      const dep = parseIntField(d.depBps)
      const cpa = parseInt64Field(d.cpa)
      const ms = parseIntField(d.minSig)
      const md = parseIntField(d.minDep)
      const mv = parseInt64Field(d.minVol)
      if (ngr !== undefined) body.ngr_revshare_bps = ngr
      if (dep !== undefined) body.deposit_revshare_bps = dep
      if (cpa !== undefined) body.first_deposit_cpa_minor = cpa
      if (ms !== undefined) body.min_referred_signups = ms
      if (md !== undefined) body.min_referred_depositors = md
      if (mv !== undefined) body.min_referred_deposit_volume_minor = mv

      const res = await apiFetch(`/v1/admin/referrals/tiers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error(`Save failed (${res.status})`)
        return
      }
      toast.success('Tier updated')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageMeta title="Referral tiers · Admin" description="Player referral program rates and thresholds" />
      <PageBreadcrumb
        pageTitle="Referral program tiers"
        subtitle="NGR rev-share, deposit share, CPA, and auto-tier promotion gates."
      />

      <ComponentCard title="Tiers" desc="Superadmins can edit rows. Support can view.">
        {err ? <p className="text-danger small mb-2">{err}</p> : null}
        {loading ? <p className="text-secondary small">Loading…</p> : null}
        {!loading && tiers.length === 0 ? <p className="text-secondary small">No tiers configured.</p> : null}
        {tiers.length > 0 ? (
          <div className="table-responsive">
            <table className="table table-sm table-bordered align-middle">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Sort</th>
                  <th>Active</th>
                  <th>NGR bps</th>
                  <th>CPA minor</th>
                  <th>Dep bps</th>
                  <th>Min signups</th>
                  <th>Min depositors</th>
                  <th>Min dep volume</th>
                  {isSuper ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => {
                  const d = draft[t.id]
                  return (
                    <tr key={t.id}>
                      <td className="font-monospace small">{t.id}</td>
                      <td style={{ minWidth: 120 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.name}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], name: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          t.name
                        )}
                      </td>
                      <td style={{ width: 88 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.sort_order}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], sort_order: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          t.sort_order
                        )}
                      </td>
                      <td>
                        {isSuper && d ? (
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={d.active}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], active: e.target.checked },
                              }))
                            }
                          />
                        ) : t.active ? (
                          'yes'
                        ) : (
                          'no'
                        )}
                      </td>
                      <td style={{ width: 96 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.ngr}
                            placeholder="e.g. 500"
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], ngr: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          t.ngr_revshare_bps ?? '—'
                        )}
                      </td>
                      <td style={{ width: 104 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.cpa}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], cpa: e.target.value },
                              }))
                            }
                          />
                        ) : t.first_deposit_cpa_minor != null ? (
                          formatCurrency(t.first_deposit_cpa_minor)
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ width: 96 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.depBps}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], depBps: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          t.deposit_revshare_bps ?? '—'
                        )}
                      </td>
                      <td style={{ width: 96 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.minSig}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], minSig: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          t.min_referred_signups ?? '—'
                        )}
                      </td>
                      <td style={{ width: 96 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.minDep}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], minDep: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          t.min_referred_depositors ?? '—'
                        )}
                      </td>
                      <td style={{ width: 112 }}>
                        {isSuper && d ? (
                          <input
                            className="form-control form-control-sm"
                            value={d.minVol}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [t.id]: { ...prev[t.id], minVol: e.target.value },
                              }))
                            }
                          />
                        ) : t.min_referred_deposit_volume_minor != null ? (
                          formatCurrency(t.min_referred_deposit_volume_minor)
                        ) : (
                          '—'
                        )}
                      </td>
                      {isSuper ? (
                        <td>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busyId === t.id}
                            onClick={() => void saveTier(t.id)}
                          >
                            {busyId === t.id ? 'Saving…' : 'Save'}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <button type="button" className="btn btn-outline-secondary btn-sm mt-2" onClick={() => void load()}>
          Refresh
        </button>
      </ComponentCard>
    </>
  )
}
