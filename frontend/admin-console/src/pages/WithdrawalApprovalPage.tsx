import { useState } from 'react'
import { useAdminAuth } from '../authContext'
import { StatCard, StatusBadge } from '../components/dashboard'
import { usePendingWithdrawals } from '../hooks/useDashboard'
import { formatCurrency, formatRelativeTime } from '../lib/format'

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-gray-200 dark:bg-gray-700" />
        </td>
      ))}
    </tr>
  )
}

export default function WithdrawalApprovalPage() {
  const { apiFetch } = useAdminAuth()
  const { data, loading, error, refetch } = usePendingWithdrawals()

  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null)

  const pending = data?.pending ?? []
  const pendingCount = data?.count ?? 0
  const pendingValue = pending.reduce((sum: number, w: any) => sum + (w.amount_minor ?? 0), 0)

  const handleApprove = async (id: string) => {
    setActionBusy(id)
    setActionError(null)
    try {
      const res = await apiFetch(`/v1/admin/withdrawals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`Approve failed (${res.status})`)
      setConfirmApprove(null)
      await refetch()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setActionBusy(null)
    }
  }

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return
    setActionBusy(id)
    setActionError(null)
    try {
      const res = await apiFetch(`/v1/admin/withdrawals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      })
      if (!res.ok) throw new Error(`Reject failed (${res.status})`)
      setRejectTarget(null)
      setRejectReason('')
      await refetch()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Withdrawal Approval</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Pending Withdrawals"
          value={String(pendingCount)}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Total Pending Value"
          value={formatCurrency(pendingValue)}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Errors */}
      {(error || actionError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {actionError ?? error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              ) : pending.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                    No pending withdrawals.
                  </td>
                </tr>
              ) : (
                pending.map((w: any, idx: number) => {
                  const amountMajor = (w.amount_minor ?? 0) / 100
                  const isHigh = amountMajor > 1000
                  return (
                    <tr
                      key={w.id}
                      className={`transition-colors ${idx % 2 === 1 ? 'bg-gray-50/50 dark:bg-white/[0.01]' : ''}`}
                    >
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        <span className="font-mono text-xs">{w.email ?? w.user_id}</span>
                      </td>
                      <td className={`px-4 py-3 font-medium ${isHigh ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                        {formatCurrency(w.amount_minor ?? 0, w.currency ?? 'USD')}
                        {isHigh && (
                          <span className="ml-1.5 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-400">
                            HIGH
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {(w.currency ?? 'USD').toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={w.status ?? 'pending'} variant="warning" dot />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400" title={w.created_at}>
                        {formatRelativeTime(w.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={actionBusy === w.id}
                            onClick={() => setConfirmApprove(w.id)}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy === w.id}
                            onClick={() => { setRejectTarget(w.id); setRejectReason('') }}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approve confirmation modal */}
      {confirmApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Confirm Approval</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Are you sure you want to approve this withdrawal? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmApprove(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy === confirmApprove}
                onClick={() => void handleApprove(confirmApprove)}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                {actionBusy === confirmApprove ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject reason modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Reject Withdrawal</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Please provide a reason for rejecting this withdrawal.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Rejection reason…"
              className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setRejectTarget(null); setRejectReason('') }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || actionBusy === rejectTarget}
                onClick={() => void handleReject(rejectTarget)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {actionBusy === rejectTarget ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
