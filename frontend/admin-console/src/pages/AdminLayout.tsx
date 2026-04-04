import { useEffect, type FC } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import AppLayout from '../layout/AppLayout'

const AdminLayout: FC = () => {
  const { accessToken, refreshMe } = useAdminAuth()

  useEffect(() => {
    if (accessToken) void refreshMe()
  }, [accessToken, refreshMe])

  if (!accessToken) return <Navigate to="/login" replace />

  return <AppLayout />
}

export default AdminLayout
