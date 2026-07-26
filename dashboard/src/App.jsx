import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminRoute } from './auth/AdminRoute'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './layouts/AppLayout'
import { Admin } from './pages/Admin'
import { AccountStatus } from './pages/AccountStatus'
import { CandidateDetails } from './pages/CandidateDetails'
import { Candidates } from './pages/Candidates'
import { FindTarget } from './pages/FindTarget'
import { Login } from './pages/Login'
import { Landing } from './pages/Landing'
import { NotFound } from './pages/NotFound'
import { Overview } from './pages/Overview'
import { RunDetails } from './pages/RunDetails'
import { Runs } from './pages/Runs'
import { TopCandidates } from './pages/TopCandidates'
import { Unauthorized } from './pages/Unauthorized'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin/login" element={<Login adminOnly />} />
      <Route path="/approval-pending" element={<AccountStatus status="pending" />} />
      <Route path="/account-rejected" element={<AccountStatus status="rejected" />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route element={<AdminRoute />}>
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<Overview />} />
          <Route path="top-candidates" element={<TopCandidates />} />
          <Route path="candidates" element={<Candidates />} />
          <Route path="candidates/:id" element={<CandidateDetails />} />
          <Route path="runs" element={<Runs />} />
          <Route path="runs/:id" element={<RunDetails />} />
          <Route path="find-target" element={<FindTarget />} />
          <Route path="overview" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
