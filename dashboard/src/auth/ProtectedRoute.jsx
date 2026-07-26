import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingState } from '../components/StateBlocks'
import { useAuth } from './useAuth'

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.isLoading) return <LoadingState label="Checking your session..." />
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (!auth.profile && !auth.authError) {
    return <LoadingState label="Loading your account..." />
  }
  if (!auth.profile) return <Navigate to="/unauthorized" replace />
  if (!auth.profile.is_active) return <Navigate to="/account-rejected" replace />
  if (auth.profile.approval_status === 'pending') return <Navigate to="/approval-pending" replace />
  if (auth.profile.approval_status === 'rejected') return <Navigate to="/account-rejected" replace />
  if (!auth.isApproved) return <Navigate to="/unauthorized" replace />

  return <Outlet />
}
