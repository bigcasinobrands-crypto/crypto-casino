import AdminDataTable from '../components/admin/AdminDataTable'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { useAdminAuth } from '../authContext'

type Props = { title: string; path: string; refreshIntervalMs?: number }

export default function DataTablePage({ title, path, refreshIntervalMs }: Props) {
  const { apiFetch } = useAdminAuth()

  return (
    <>
      <PageMeta title={`${title} · Admin`} description={`Admin data: ${title}`} />
      <PageBreadcrumb pageTitle={title} />
      <ComponentCard title={title} desc={`GET ${path}`}>
        <AdminDataTable apiPath={path} apiFetch={apiFetch} refreshIntervalMs={refreshIntervalMs} />
      </ComponentCard>
    </>
  )
}
