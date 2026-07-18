import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingState } from '../components/StateBlocks'
import { useAuth } from './useAuth'

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.isLoading) return <LoadingState label="Checking your session..." />
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (!auth.profile?.is_active) return <Navigate to="/login" replace />

  return <Outlet />
}
