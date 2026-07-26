import { Search, ShieldCheck, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '../StateBlocks'
import { formatDate } from '../../utils/format'

function initials(name, email) {
  const source = String(name || email || '?').trim()
  const parts = source.split(/\s+/)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : source.slice(0, 2)).toUpperCase()
}

export function AllUsersPanel({ authUserId, busyId, error, loading, onDelete, onRetry, onSetActive, onSetRole, users }) {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('newest')
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return users.filter((user) => {
      if (needle && !`${user.full_name || ''} ${user.email || ''}`.toLowerCase().includes(needle)) return false
      if (role !== 'all' && user.role !== role) return false
      if (status === 'active' && !user.is_active) return false
      if (status === 'disabled' && user.is_active) return false
      return true
    }).sort((a, b) => {
      const difference = String(b.created_at || '').localeCompare(String(a.created_at || ''))
      return sort === 'oldest' ? -difference : difference
    })
  }, [role, search, sort, status, users])

  return (
    <section className="admin-glass-panel admin-section-panel" aria-labelledby="all-users-title">
      <div className="admin-panel-heading">
        <div><p className="admin-technical-label">AUTHORIZED DIRECTORY</p><h2 id="all-users-title">All Users</h2><p>Review approved accounts, roles, access status, and creation dates.</p></div>
        <span className="admin-count-badge"><Users size={15} /> {filtered.length} Accounts</span>
      </div>
      <div className="admin-directory-filters">
        <label className="admin-search-field"><span className="sr-only">Search by name or email</span><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" /></label>
        <label><span className="sr-only">Filter role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option><option value="user">Users</option><option value="admin">Admins</option></select></label>
        <label><span className="sr-only">Filter access</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All access</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
        <label><span className="sr-only">Sort users</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>
      {loading && !users.length ? <LoadingState label="Loading authorized users..." /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {!loading && !error && !filtered.length ? <EmptyState title="No matching users" message="Adjust the directory filters or create an authorized account." /> : null}
      {filtered.length ? (
        <div className="admin-data-table-wrap">
          <table className="admin-data-table admin-users-table">
            <thead><tr><th>User</th><th>Email</th><th>Contact Number</th><th>Role</th><th>Approval Status</th><th>Created</th><th>Approved</th><th>Actions</th></tr></thead>
            <tbody>{filtered.map((user) => {
              const self = user.id === authUserId
              const busy = user.id === busyId
              return (
                <tr key={user.id}>
                  <td><div className="admin-user-cell"><span>{initials(user.full_name, user.email)}</span><strong>{user.full_name || 'Name unavailable'}</strong></div></td>
                  <td>{user.email || 'Not available'}</td>
                  <td>{user.contact_number || 'Not available'}</td>
                  <td><select value={user.role || 'user'} disabled={busy || self} aria-label={`Role for ${user.email}`} onChange={(event) => onSetRole(user, event.target.value)}><option value="user">User</option><option value="admin">Admin</option></select></td>
                  <td><span className={`admin-status-chip ${user.is_active ? 'is-active' : 'is-disabled'}`}><span />{user.is_active ? 'Approved' : 'Disabled'}</span></td>
                  <td>{formatDate(user.created_at)}</td><td>{formatDate(user.approved_at)}</td>
                  <td><div className="admin-row-controls">
                    <button type="button" disabled={busy || self} onClick={() => onSetActive(user, !user.is_active)}><ShieldCheck size={14} />{user.is_active ? 'Disable' : 'Activate'}</button>
                    <button type="button" className="is-danger" disabled={busy || self} onClick={() => onDelete(user)}><Trash2 size={14} />Remove</button>
                  </div></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
