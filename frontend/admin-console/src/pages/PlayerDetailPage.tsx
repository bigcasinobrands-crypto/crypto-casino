import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import { formatApiError, readApiError } from '../api/errors'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

function SupportCrmLink({ userId }: { userId: string }) {
  const href = useMemo(() => {
    const tpl = String(import.meta.env.VITE_SUPPORT_CRM_URL_TEMPLATE ?? '').trim()
    if (!tpl) return ''
    return tpl.replaceAll('{user_id}', userId).replaceAll('{userId}', userId)
  }, [userId])
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
    >
      Open in CRM
    </a>
  )
}

export default function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { apiFetch } = useAdminAuth()
  const { reportApiFailure } = useAdminActivityLog()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setErr(null)
    const path = `/v1/admin/users/${encodeURIComponent(id)}`
    const res = await apiFetch(path)
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path })
      setErr(formatApiError(parsed, `HTTP ${res.status}`))
      setData(null)
      return
    }
    setData((await res.json()) as Record<string, unknown>)
  }, [apiFetch, id, reportApiFailure])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const downloadExport = async () => {
    if (!id) return
    const exportPath = `/v1/admin/users/${encodeURIComponent(id)}/export`
    const res = await apiFetch(exportPath)
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path: exportPath })
      setErr(formatApiError(parsed, 'Export failed'))
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `user-${id}-export.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageMeta title="Player detail · Admin" description="Support view for a single user" />
      <PageBreadcrumb pageTitle="Player detail" />
      <div className="mb-4 text-sm">
        <Link to="/support" className="text-brand-600 underline dark:text-brand-400">
          ← Player lookup
        </Link>
      </div>
      <ComponentCard title="Profile" desc={`Player ${id ?? ''}`}>
        {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {data ? (
          <div className="flex flex-col gap-6">
            {/* Player card */}
            <div className="flex items-center gap-5">
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-brand-200 bg-gray-100 dark:border-brand-700 dark:bg-gray-800">
                {data.avatar_url ? (
                  <img
                    src={String(data.avatar_url)}
                    alt="Avatar"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-xl font-bold text-gray-400 dark:text-gray-500">
                    {(String(data.username ?? data.email ?? '?'))[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {data.username ? (
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {String(data.username)}
                  </p>
                ) : null}
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {String(data.email ?? '')}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Joined {data.created_at ? new Date(String(data.created_at)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
                </p>
              </div>
            </div>

            {/* Details table */}
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {Object.entries(data).map(([key, val]) => (
                    <tr key={key}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">{key}</td>
                      <td className="break-all px-4 py-2.5 font-mono text-xs text-gray-900 dark:text-gray-100">{val == null ? '—' : String(val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : !err ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : null}
        {id ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <SupportCrmLink userId={id} />
            <button
              type="button"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
              onClick={() => void downloadExport()}
            >
              Download GDPR export stub (JSON)
            </button>
          </div>
        ) : null}
      </ComponentCard>
    </>
  )
}
