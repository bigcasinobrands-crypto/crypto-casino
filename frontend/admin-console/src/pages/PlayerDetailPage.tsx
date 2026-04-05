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
      <ComponentCard title="Profile" desc={`GET /v1/admin/users/${id ?? ''}`}>
        {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {data ? (
          <pre className="overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900/60">
            {JSON.stringify(data, null, 2)}
          </pre>
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
