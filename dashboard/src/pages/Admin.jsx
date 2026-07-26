import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { AddUserPanel } from '../components/admin/AddUserPanel'
import { AdminHeader } from '../components/admin/AdminHeader'
import { AdminLayout } from '../components/admin/AdminLayout'
import { AdminOverviewCards } from '../components/admin/AdminOverviewCards'
import { AllUsersPanel } from '../components/admin/AllUsersPanel'
import { PendingUsersPanel } from '../components/admin/PendingUsersPanel'
import { approveUser, createUser, deleteUser, listPendingUsers, listUsers, setUserActive, setUserRole } from '../services/adminUsers'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY_FORM = { email: '', password: '', fullName: '', contactNumber: '', role: 'user' }

export function Admin() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState('pending')
  const [users, setUsers] = useState([])
  const [pendingUsers, setPendingUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [pendingLoaded, setPendingLoaded] = useState(false)
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [pendingError, setPendingError] = useState('')
  const [usersError, setUsersError] = useState('')
  const [actionError, setActionError] = useState('')
  const [message, setMessage] = useState('')
  const [lastRefreshed, setLastRefreshed] = useState('')
  const [busyId, setBusyId] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const approvedUsers = useMemo(
    () => users.filter((user) => user.approval_status === 'approved'),
    [users],
  )
  const allKnownUsers = useMemo(() => {
    const rows = new Map(users.map((user) => [user.id, user]))
    pendingUsers.forEach((user) => rows.set(user.id, user))
    return [...rows.values()]
  }, [pendingUsers, users])
  const recentCount = useMemo(() => {
    const threshold = Date.now() - (7 * 24 * 60 * 60 * 1000)
    return allKnownUsers.filter((user) => {
      const created = Date.parse(user.created_at || '')
      return Number.isFinite(created) && created >= threshold
    }).length
  }, [allKnownUsers])

  async function loadUsers() {
    setLoading(true)
    setPendingError('')
    setUsersError('')
    const [pendingResult, usersResult] = await Promise.allSettled([listPendingUsers(), listUsers()])

    if (pendingResult.status === 'fulfilled') setPendingUsers(pendingResult.value)
    else {
      console.error('Admin page could not load pending users:', pendingResult.reason)
      setPendingError(pendingResult.reason?.message || 'Could not load pending users.')
    }
    setPendingLoaded(true)

    if (usersResult.status === 'fulfilled') setUsers(usersResult.value)
    else {
      console.error('Admin page could not load users:', usersResult.reason)
      setUsersError(usersResult.reason?.message || 'Could not load users.')
    }
    setUsersLoaded(true)

    if (pendingResult.status === 'fulfilled' || usersResult.status === 'fulfilled') {
      setLastRefreshed(new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date()))
    }
    setLoading(false)
  }

  useEffect(() => {
    loadUsers()
    document.documentElement.classList.add('admin-route-scrollbar-hidden')
    document.body.classList.add('admin-route-scrollbar-hidden')
    return () => {
      document.documentElement.classList.remove('admin-route-scrollbar-hidden')
      document.body.classList.remove('admin-route-scrollbar-hidden')
    }
  }, [])

  async function handleCreate(event) {
    event.preventDefault()
    if (creating) return
    const email = form.email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) return setActionError('Enter a valid email address.')
    if (!form.fullName.trim()) return setActionError('Full name is required.')
    if (form.password.length < 8) return setActionError('Password must be at least 8 characters.')

    setCreating(true)
    setActionError('')
    setMessage('')
    try {
      await createUser({
        email,
        password: form.password,
        fullName: form.fullName.trim(),
        contactNumber: form.contactNumber.trim(),
        role: form.role,
      })
      setForm(EMPTY_FORM)
      setMessage('Account created successfully.')
      await loadUsers()
    } catch (error) {
      setActionError(error.message || 'Could not create user.')
    } finally {
      setCreating(false)
    }
  }

  async function runUserAction(user, action, successMessage) {
    setBusyId(user.id)
    setActionError('')
    setMessage('')
    try {
      await action()
      setMessage(successMessage)
      await loadUsers()
    } catch (error) {
      setActionError(error.message || 'Admin action failed.')
    } finally {
      setBusyId('')
    }
  }

  function handleApprove(user) {
    return runUserAction(user, () => approveUser(user.id), 'User approved successfully.')
  }

  function handleDelete(user) {
    if (!window.confirm(`Remove ${user.email || 'this user'}? This permanently deletes the account.`)) return
    return runUserAction(user, () => deleteUser(user.id), 'User account removed.')
  }

  async function handleLogout() {
    await auth.signOut()
    navigate('/admin/login', { replace: true })
  }

  return (
    <AdminLayout activeSection={activeSection} adminEmail={auth.user?.email} onLogout={handleLogout} onSectionChange={setActiveSection}>
      <AdminHeader activeSection={activeSection} loading={loading} onRefresh={loadUsers} lastRefreshed={lastRefreshed} />
      <AdminOverviewCards
        pendingCount={pendingLoaded ? pendingUsers.length : null}
        approvedCount={usersLoaded ? approvedUsers.length : null}
        totalCount={pendingLoaded && usersLoaded ? allKnownUsers.length : null}
        recentCount={pendingLoaded && usersLoaded ? recentCount : null}
      />
      <div className="admin-section-transition" key={activeSection}>
        {activeSection === 'pending' ? <PendingUsersPanel users={pendingUsers} loaded={pendingLoaded} error={pendingError} busyId={busyId} onApprove={handleApprove} onRetry={loadUsers} /> : null}
        {activeSection === 'add' ? <AddUserPanel form={form} creating={creating} error={actionError} message={message} onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))} onSubmit={handleCreate} /> : null}
        {activeSection === 'users' ? <AllUsersPanel users={approvedUsers} loading={loading} error={usersError} busyId={busyId} authUserId={auth.user?.id} onRetry={loadUsers} onDelete={handleDelete} onSetActive={(user, value) => runUserAction(user, () => setUserActive(user.id, value), 'Account access updated.')} onSetRole={(user, role) => runUserAction(user, () => setUserRole(user.id, role), 'Account role updated.')} /> : null}
      </div>
      <div className="admin-live-feedback" aria-live="polite" aria-atomic="true">
        {message && activeSection !== 'add' ? <p className="admin-feedback is-success">{message}</p> : null}
        {actionError && activeSection !== 'add' ? <p className="admin-feedback is-error" role="alert">{actionError}</p> : null}
      </div>
    </AdminLayout>
  )
}
