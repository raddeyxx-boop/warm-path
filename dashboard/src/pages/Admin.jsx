import { LogOut, RefreshCcw, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { EmptyState, ErrorState, LoadingState } from '../components/StateBlocks'
import { createUser, deleteUser, listUsers, setUserActive, setUserRole } from '../services/adminUsers'
import { formatDate } from '../utils/format'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Admin() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', fullName: '', role: 'user' })

  const sortedUsers = useMemo(() => [...users].sort((a, b) => String(a.email || '').localeCompare(String(b.email || ''))), [users])

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      setUsers(await listUsers())
    } catch (err) {
      setError(err.message || 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  async function handleCreate(event) {
    event.preventDefault()
    const email = form.email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setCreating(true)
    setError('')
    setMessage('')
    try {
      await createUser({
        email,
        password: form.password,
        fullName: form.fullName.trim(),
        role: form.role,
      })
      setForm({ email: '', password: '', fullName: '', role: 'user' })
      setMessage(`Created ${email}.`)
      await loadUsers()
    } catch (err) {
      setError(err.message || 'Could not create user.')
    } finally {
      setCreating(false)
    }
  }

  async function runUserAction(user, action) {
    setBusyId(user.id)
    setError('')
    setMessage('')
    try {
      await action()
      await loadUsers()
    } catch (err) {
      setError(err.message || 'Admin action failed.')
    } finally {
      setBusyId('')
    }
  }

  async function handleDelete(user) {
    const confirmed = window.confirm('Deleting this user permanently removes the account and may remove all data owned by this user.')
    if (!confirmed) return
    await runUserAction(user, async () => {
      await deleteUser(user.id)
      setMessage(`Deleted ${user.email || 'user'}.`)
    })
  }

  async function handleLogout() {
    await auth.signOut()
    navigate('/admin/login', { replace: true })
  }

  return (
    <main className="admin-page">
      <section className="section-dark admin-hero">
        <div>
          <p className="eyebrow">System control</p>
          <h1>User Management</h1>
          <p>Manage Supabase Auth users, roles, and active account status.</p>
        </div>
        <div className="admin-actions">
          <button type="button" className="button button-secondary" onClick={loadUsers} disabled={loading}>
            <RefreshCcw size={16} aria-hidden="true" />
            Refresh
          </button>
          <button type="button" className="button button-secondary" onClick={handleLogout}>
            <LogOut size={16} aria-hidden="true" />
            Logout
          </button>
        </div>
      </section>

      <section className="card detail-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Create account</p>
            <h2>Add User</h2>
          </div>
        </div>
        <form className="admin-create-form" onSubmit={handleCreate}>
          <label>
            <span>Email</span>
            <input type="email" value={form.email} autoComplete="email" onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={form.password} autoComplete="new-password" minLength={8} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          </label>
          <label>
            <span>Full name</span>
            <input value={form.fullName} autoComplete="name" onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
          </label>
          <label>
            <span>Role</span>
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="button button-primary" disabled={creating}>
            <UserPlus size={16} aria-hidden="true" />
            {creating ? 'Creating...' : 'Add User'}
          </button>
        </form>
        {message ? <p className="form-message form-message-success" role="status">{message}</p> : null}
        {error ? <p className="form-message form-message-error" role="alert">{error}</p> : null}
      </section>

      <section className="card detail-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Accounts</p>
            <h2>User List</h2>
          </div>
        </div>
        {loading ? <LoadingState label="Loading users..." /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={loadUsers} /> : null}
        {!loading && !error && !sortedUsers.length ? <EmptyState title="No users" message="No Auth users were returned." /> : null}
        {!loading && !error && sortedUsers.length ? (
          <div className="table-wrap admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last sign in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((user) => {
                  const isSelf = user.id === auth.user?.id
                  const busy = busyId === user.id
                  return (
                    <tr key={user.id}>
                      <td>{user.email || 'Not available'}</td>
                      <td>{user.full_name || 'Not available'}</td>
                      <td>
                        <select
                          value={user.role || 'user'}
                          disabled={busy || isSelf}
                          aria-label={`Role for ${user.email}`}
                          onChange={(event) => runUserAction(user, () => setUserRole(user.id, event.target.value))}
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>{user.is_active ? 'Active' : 'Disabled'}</td>
                      <td>{formatDate(user.created_at)}</td>
                      <td>{formatDate(user.last_sign_in_at)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busy || isSelf}
                            onClick={() => runUserAction(user, () => setUserActive(user.id, !user.is_active))}
                          >
                            <ShieldCheck size={15} aria-hidden="true" />
                            {user.is_active ? 'Disable' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busy || isSelf}
                            onClick={() => handleDelete(user)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  )
}
