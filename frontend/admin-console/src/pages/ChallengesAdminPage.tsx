import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { ChallengeCreatePanel } from '../components/challenges/ChallengeCreatePanel'
import { ChallengeEditModal } from '../components/challenges/ChallengeEditModal'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'
import { Dropdown } from '../components/ui/dropdown/Dropdown'
import { DropdownItem } from '../components/ui/dropdown/DropdownItem'
import { adminApiUrl } from '../lib/adminApiUrl'
import { formatMinorToMajor } from '../lib/format'

type Row = {
  id: string
  slug: string
  title: string
  description: string
  challenge_type: string
  status: string
  prize_type: string
  max_winners: number
  winners_count: number
  starts_at: string
  ends_at: string
  created_at: string
  hero_image_url?: string
  badge_label?: string
  min_bet_amount_minor?: number
  prize_amount_minor?: number
  prize_currency?: string
  prize_wagering_multiplier?: number
  prize_free_spins?: number
  /** When true, anonymous players never see this challenge; VIP eligibility is enforced on the API. */
  vip_only?: boolean
}

function errBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) return { code: err.code, message: err.message ?? '', status }
  }
  return null
}

function heroSrc(url: string | undefined): string {
  const t = (url ?? '').trim()
  if (!t) return ''
  if (t.startsWith('//')) return `https:${t}`
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return adminApiUrl(t.startsWith('/') ? t : `/${t}`)
}

function isPublicScheduleStatus(s: string): boolean {
  return s === 'active' || s === 'scheduled'
}

function isTerminalCatalogStatus(s: string): boolean {
  return s === 'completed' || s === 'cancelled'
}

function formatPrize(r: Row): string {
  if (r.prize_type === 'cash' && typeof r.prize_amount_minor === 'number') {
    return formatMinorToMajor(r.prize_amount_minor)
  }
  if (r.prize_type === 'bonus' && typeof r.prize_amount_minor === 'number') {
    const wr = typeof r.prize_wagering_multiplier === 'number' ? r.prize_wagering_multiplier : 0
    return `${formatMinorToMajor(r.prize_amount_minor)} bonus ×${wr} WR`
  }
  if (r.prize_type === 'free_spins') {
    const n = typeof r.prize_free_spins === 'number' ? r.prize_free_spins : null
    return n != null && n > 0 ? `${n} free spins` : 'Free spins'
  }
  return r.prize_type.replace(/_/g, ' ')
}

export default function ChallengesAdminPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [quickMenuId, setQuickMenuId] = useState<string | null>(null)
  const [bulkWorking, setBulkWorking] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
      const res = await apiFetch(`/v1/admin/challenges${q}`)
      let j: { challenges?: Row[] } | null = null
      try {
        j = (await res.json()) as { challenges?: Row[] }
      } catch {
        j = null
      }
      if (!res.ok) {
        setErr(formatApiError(errBody(res.status, j), `Load failed (${res.status})`))
        setRows([])
        return
      }
      setRows(Array.isArray(j?.challenges) ? j!.challenges! : [])
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setSelected(new Set())
  }, [statusFilter])

  const selectedList = useMemo(() => [...selected], [selected])
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const selectedCount = selected.size

  const patchChallengeStatus = useCallback(
    async (id: string, status: string): Promise<boolean> => {
      const res = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(formatApiError(errBody(res.status, j), 'Could not update challenge'))
        return false
      }
      return true
    },
    [apiFetch],
  )

  const deleteChallengeById = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await apiFetch(`/v1/admin/challenges/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(formatApiError(errBody(res.status, j), 'Could not delete challenge'))
        return false
      }
      return true
    },
    [apiFetch],
  )

  const setLiveOnCatalog = useCallback(
    async (row: Row, live: boolean) => {
      if (!isSuper) return
      setTogglingId(row.id)
      try {
        let nextStatus: string
        if (!live) {
          nextStatus = 'paused'
        } else {
          const starts = new Date(row.starts_at).getTime()
          const ends = new Date(row.ends_at).getTime()
          const now = Date.now()
          if (now >= ends) {
            toast.error('This challenge has already ended. Open the editor or full page to adjust dates.')
            return
          }
          nextStatus = now < starts ? 'scheduled' : 'active'
        }
        const ok = await patchChallengeStatus(row.id, nextStatus)
        if (ok) {
          toast.success(live ? 'Challenge is live for players (active / scheduled).' : 'Challenge paused — hidden from lobby.')
          await load()
        }
      } catch {
        toast.error('Network error')
      } finally {
        setTogglingId(null)
      }
    },
    [isSuper, load, patchChallengeStatus],
  )

  const runRowAction = useCallback(
    async (row: Row, status: string, success: string) => {
      if (!isSuper) return
      setBusyId(row.id)
      setQuickMenuId(null)
      try {
        const ok = await patchChallengeStatus(row.id, status)
        if (ok) {
          toast.success(success)
          setSelected((prev) => {
            const n = new Set(prev)
            n.delete(row.id)
            return n
          })
          await load()
        }
      } finally {
        setBusyId(null)
      }
    },
    [isSuper, load, patchChallengeStatus],
  )

  const confirmDeleteRow = useCallback(
    async (row: Row) => {
      if (!isSuper) return
      setQuickMenuId(null)
      const ok = window.confirm(
        `Delete “${row.title}”? This removes the challenge, entries, and related bet events permanently.`,
      )
      if (!ok) return
      setBusyId(row.id)
      try {
        if (await deleteChallengeById(row.id)) {
          toast.success('Challenge deleted.')
          setSelected((prev) => {
            const n = new Set(prev)
            n.delete(row.id)
            return n
          })
          await load()
        }
      } finally {
        setBusyId(null)
      }
    },
    [isSuper, deleteChallengeById, load],
  )

  const bulkPatch = useCallback(
    async (status: string, successLabel: string) => {
      if (!isSuper || selectedList.length === 0) return
      setBulkWorking(true)
      let okc = 0
      try {
        for (const id of selectedList) {
          if (await patchChallengeStatus(id, status)) okc++
        }
        if (okc === selectedList.length) {
          toast.success(`${successLabel} (${okc})`)
        } else if (okc > 0) {
          toast.warning(`${successLabel}: ${okc} of ${selectedList.length} succeeded.`)
        }
        setSelected(new Set())
        await load()
      } finally {
        setBulkWorking(false)
      }
    },
    [isSuper, selectedList, patchChallengeStatus, load],
  )

  const bulkDelete = useCallback(async () => {
    if (!isSuper || selectedList.length === 0) return
    const ok = window.confirm(
      `Delete ${selectedList.length} challenge(s)? Entries and related bet events will be removed. This cannot be undone.`,
    )
    if (!ok) return
    setBulkWorking(true)
    let okc = 0
    try {
      for (const id of selectedList) {
        if (await deleteChallengeById(id)) okc++
      }
      if (okc === selectedList.length) {
        toast.success(`Deleted ${okc} challenge(s).`)
      } else if (okc > 0) {
        toast.warning(`Deleted ${okc} of ${selectedList.length}.`)
      }
      setSelected(new Set())
      await load()
    } finally {
      setBulkWorking(false)
    }
  }, [isSuper, selectedList, deleteChallengeById, load])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (rows.length === 0) return prev
      if (rows.every((r) => prev.has(r.id))) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }, [rows])

  const backdropCls = 'modal fade show d-block'
  const backdropStyle: CSSProperties = {
    backgroundColor: 'rgba(12, 14, 18, 0.55)',
    backdropFilter: 'blur(8px)',
  }

  const draftCount = useMemo(() => rows.filter((r) => r.status === 'draft').length, [rows])

  return (
    <>
      <PageMeta title="Engagement · Challenges" description="Casino challenges — list and monitor entries." />
      <div className="mb-4 d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <h2 className="h5 mb-1 text-body">Challenges</h2>
          <p className="text-secondary small mb-0">
            The player app only lists challenges in <strong>scheduled</strong> or <strong>active</strong> status.
            <strong> Draft / paused</strong> do not appear until you turn on <strong>Live in player app</strong> (superadmin).
            Wager progress and cash prizes post through the ledger when players play.{' '}
            <Link to="/engagement/challenges/flagged" className="link-primary">
              Flagged entries
            </Link>
            .
          </p>
        </div>
        {isSuper ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
            New challenge
          </button>
        ) : null}
      </div>

      <ComponentCard title="Catalog">
        {!loading && draftCount > 0 ? (
          <div className="alert alert-warning py-2 px-3 small mb-3 border-warning" role="status">
            <strong>{draftCount}</strong> challenge{draftCount === 1 ? '' : 's'} in <strong>draft</strong> — hidden from
            the player site. Toggle <strong>Live in player app</strong> on each card (or open Edit and save) to publish.
          </div>
        ) : null}
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <label className="small text-secondary mb-0">
            Status{' '}
            <select
              className="form-select form-select-sm d-inline-block w-auto ms-1"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="draft">draft</option>
              <option value="scheduled">scheduled</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {isSuper && !loading && rows.length > 0 ? (
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3 p-2 rounded border border-secondary bg-body-tertiary">
            <div className="form-check mb-0">
              <input
                id="challenge-select-all"
                className="form-check-input"
                type="checkbox"
                checked={allSelected}
                disabled={bulkWorking}
                onChange={() => toggleSelectAll()}
              />
              <label className="form-check-label small" htmlFor="challenge-select-all">
                Select all ({rows.length})
              </label>
            </div>
            {selectedCount > 0 ? (
              <>
                <span className="small text-secondary">{selectedCount} selected</span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  disabled={bulkWorking}
                  onClick={() => void bulkPatch('paused', 'Hidden from lobby (paused)')}
                >
                  Hide (pause)
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  disabled={bulkWorking}
                  onClick={() => void bulkPatch('draft', 'Moved to draft')}
                >
                  Draft
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  disabled={bulkWorking}
                  onClick={() => void bulkPatch('archived', 'Archived')}
                >
                  Archive
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  disabled={bulkWorking}
                  onClick={() => void bulkDelete()}
                >
                  Delete…
                </button>
              </>
            ) : (
              <span className="small text-secondary">Select cards to run bulk actions.</span>
            )}
          </div>
        ) : null}

        {err ? <div className="alert alert-danger py-2 small">{err}</div> : null}
        {loading ? (
          <p className="text-secondary small mb-0">Loading…</p>
        ) : (
          <>
            <div className="row row-cols-2 row-cols-md-3 row-cols-xl-5 g-3">
              {rows.map((r) => {
                const h = heroSrc(r.hero_image_url)
                const liveLocked = isTerminalCatalogStatus(r.status)
                const toggleDisabled = !isSuper || togglingId === r.id || liveLocked
                const rowBusy = busyId === r.id
                const terminal = isTerminalCatalogStatus(r.status)
                const menuOpen = quickMenuId === r.id
                const canPauseDraft = !terminal && r.status !== 'archived'

                return (
                  <div key={r.id} className="col">
                    <div
                      className="h-100 d-flex flex-column rounded border border-secondary overflow-hidden bg-body-secondary"
                      style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }}
                    >
                      <div className="d-flex align-items-center gap-2 px-2 py-2 border-bottom border-secondary small">
                        {isSuper ? (
                          <input
                            type="checkbox"
                            className="form-check-input flex-shrink-0 mt-0"
                            style={{ width: '1.05rem', height: '1.05rem' }}
                            checked={selected.has(r.id)}
                            disabled={bulkWorking || rowBusy}
                            onChange={() => toggleSelect(r.id)}
                            aria-label={`Select ${r.title}`}
                          />
                        ) : null}
                        <span className="badge text-uppercase bg-secondary text-truncate" style={{ maxWidth: '7rem' }}>
                          {r.status}
                        </span>
                        {isSuper ? (
                          <div className="ms-auto position-relative">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary py-0 px-2 dropdown-toggle"
                              disabled={rowBusy || bulkWorking}
                              aria-expanded={menuOpen}
                              onClick={() => setQuickMenuId(menuOpen ? null : r.id)}
                            >
                              ⋮
                            </button>
                            <Dropdown
                              isOpen={menuOpen}
                              onClose={() => setQuickMenuId(null)}
                              className="dropdown-menu-end mt-1"
                              style={{ minWidth: '11rem' }}
                            >
                              <DropdownItem
                                className={!canPauseDraft || r.status === 'paused' ? 'disabled' : ''}
                                onClick={() => {
                                  if (!canPauseDraft || r.status === 'paused') return
                                  void runRowAction(r, 'paused', 'Challenge paused — hidden from lobby.')
                                }}
                              >
                                Hide from player app
                              </DropdownItem>
                              <DropdownItem
                                className={!canPauseDraft || r.status === 'draft' ? 'disabled' : ''}
                                onClick={() => {
                                  if (!canPauseDraft || r.status === 'draft') return
                                  void runRowAction(r, 'draft', 'Moved to draft.')
                                }}
                              >
                                Move to draft
                              </DropdownItem>
                              <DropdownItem
                                className={r.status === 'archived' ? 'disabled' : ''}
                                onClick={() => {
                                  if (r.status === 'archived') return
                                  void runRowAction(r, 'archived', 'Archived — tidy catalog, still in admin.')
                                }}
                              >
                                Archive
                              </DropdownItem>
                              <hr className="dropdown-divider" />
                              <DropdownItem
                                className="text-danger"
                                onClick={() => void confirmDeleteRow(r)}
                              >
                                Delete…
                              </DropdownItem>
                            </Dropdown>
                          </div>
                        ) : null}
                      </div>
                      <div
                        className="position-relative w-100 bg-black flex-shrink-0"
                        style={{ aspectRatio: '3 / 4' }}
                      >
                        {h ? (
                          <img
                            src={h}
                            alt=""
                            className="w-100 h-100"
                            style={{ objectFit: 'cover' }}
                            loading="lazy"
                          />
                        ) : (
                          <div className="d-flex w-100 h-100 align-items-center justify-content-center text-secondary small">
                            No image
                          </div>
                        )}
                        {r.badge_label ? (
                          <span className="position-absolute top-0 end-0 m-2 badge bg-dark bg-opacity-75 text-white small">
                            {r.badge_label}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex-grow-1 d-flex flex-column p-3 small">
                        <div className="fw-bold text-body text-truncate mb-2" title={r.title}>
                          {r.title}
                        </div>
                        <p className="text-secondary mb-3" style={{ fontSize: '0.8rem', minHeight: '2.6rem' }}>
                          {(r.description || '—').length > 120
                            ? `${(r.description || '—').slice(0, 117)}…`
                            : r.description || '—'}
                        </p>
                        <div className="mb-2">
                          <span className="text-secondary">Prize </span>
                          <span className="fw-semibold text-success">{formatPrize(r)}</span>
                        </div>
                        <div className="mb-3 small">
                          <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                            Winners{' '}
                            <span className="fw-semibold text-body">
                              {r.winners_count} / {r.max_winners}
                            </span>
                          </div>
                          <div className="text-secondary mt-1" style={{ fontSize: '0.75rem' }}>
                            Ends{' '}
                            <span className="text-body">
                              {new Date(r.ends_at).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </span>
                          </div>
                        </div>
                        <div className="form-check form-switch mb-2">
                          <input
                            id={`live-${r.id}`}
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            checked={isPublicScheduleStatus(r.status)}
                            disabled={toggleDisabled}
                            onChange={(e) => void setLiveOnCatalog(r, e.target.checked)}
                          />
                          <label className="form-check-label" htmlFor={`live-${r.id}`}>
                            Live in player app
                          </label>
                        </div>
                        {r.status === 'draft' ? (
                          <p className="text-warning mb-2 small" style={{ fontSize: '0.72rem' }}>
                            Not visible to players until Live is on (becomes scheduled or active).
                          </p>
                        ) : null}
                        {r.vip_only ? (
                          <p className="text-secondary mb-2" style={{ fontSize: '0.68rem' }}>
                            VIP-only: guests do not see this in the list; signed-in players must meet tier rules.
                          </p>
                        ) : null}
                        {liveLocked ? (
                          <p className="text-secondary mb-0" style={{ fontSize: '0.7rem' }}>
                            Terminal status — adjust on full page if needed.
                          </p>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary mt-auto"
                          onClick={() => setEditId(r.id)}
                        >
                          {isSuper ? 'Edit…' : 'View…'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {rows.length === 0 ? <p className="text-secondary small mt-2 mb-0">No challenges match.</p> : null}
          </>
        )}
      </ComponentCard>

      {createOpen && isSuper ? (
        <div
          className={backdropCls}
          style={backdropStyle}
          role="dialog"
          aria-modal="true"
          aria-labelledby="challenge-create-title"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content bg-body text-body border-secondary">
              <div className="modal-header border-secondary">
                <h5 className="modal-title" id="challenge-create-title">
                  New challenge
                </h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setCreateOpen(false)} />
              </div>
              <div className="modal-body">
                <ChallengeCreatePanel
                  onCreated={() => {
                    setCreateOpen(false)
                    void load()
                  }}
                  onCancel={() => setCreateOpen(false)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editId ? (
        <div
          className={backdropCls}
          style={backdropStyle}
          role="dialog"
          aria-modal="true"
          aria-labelledby="challenge-edit-title"
          onClick={() => setEditId(null)}
        >
          <div
            className="modal-dialog modal-xl modal-dialog-scrollable modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content bg-body text-body border-secondary">
              <div className="modal-header border-secondary">
                <h5 className="modal-title" id="challenge-edit-title">
                  Challenge details
                </h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setEditId(null)} />
              </div>
              <div className="modal-body">
                <ChallengeEditModal
                  challengeId={editId}
                  apiFetch={apiFetch}
                  isSuper={isSuper}
                  onClose={() => setEditId(null)}
                  onSaved={() => void load()}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
