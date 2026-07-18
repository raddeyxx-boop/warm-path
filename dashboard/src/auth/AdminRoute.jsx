import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingState } from '../components/StateBlocks'
import { useAuth } from './useAuth'

export function AdminRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.isLoading) return <LoadingState label="Checking administrator access..." />
  if (!auth.isAuthenticated) return <Navigate to="/admin/login" replace state={{ from: location }} />
  if (!auth.isAdmin) return <Navigate to="/unauthorized" replace />

  return <Outlet />
}
