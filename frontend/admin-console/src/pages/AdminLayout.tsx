import { useEffect, type FC } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import AdminLTELayout from '../layout/AdminLTELayout'

const AdminLayout: FC = () => {
  const { accessToken, refreshMe } = useAdminAuth()

  useEffect(() => {
    if (accessToken) void refreshMe()
  }, [accessToken, refreshMe])

  if (!accessToken) return <Navigate to="/login" replace />

  return <AdminLTELayout />
}

export default AdminLayout
