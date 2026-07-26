import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingState } from '../components/StateBlocks'
import { useAuth } from './useAuth'

export function AdminRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.isLoading) return <LoadingState label="Checking administrator access..." />
  if (!auth.isAuthenticated) return <Navigate to="/admin/login" replace state={{ from: location }} />
  if (!auth.profile && !auth.authError) {
    return <LoadingState label="Loading administrator account..." />
  }
  if (!auth.isAdmin || auth.profile?.approval_status !== 'approved' || !auth.profile?.is_active) {
    return <Navigate to="/unauthorized" replace />
  }

  return <Outlet />
}
