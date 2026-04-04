import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

export default function SupportLookupPage() {
  const [id, setId] = useState('')
  const navigate = useNavigate()

  return (
    <>
      <PageMeta title="Player lookup · Admin" description="Open a player support record" />
      <PageBreadcrumb pageTitle="Player lookup" />
      <ComponentCard title="Find player" desc="Enter a user UUID from the players list">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const u = id.trim()
            if (!u) return
            navigate(`/support/player/${encodeURIComponent(u)}`)
          }}
        >
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-sm text-gray-600 dark:text-gray-400">
            User ID
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Open
          </button>
        </form>
      </ComponentCard>
    </>
  )
}
