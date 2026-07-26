import { Check, Clock3, Loader2, Radio, ShieldCheck } from 'lucide-react'
import { ErrorState } from '../StateBlocks'
import { formatDate } from '../../utils/format'

function initials(name, email) {
  const source = String(name || email || '?').trim()
  const parts = source.split(/\s+/)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : source.slice(0, 2)).toUpperCase()
}

export function PendingUsersPanel({ busyId, error, loaded, onApprove, onRetry, users }) {
  return (
    <section className="admin-glass-panel admin-section-panel admin-pending-command-panel" aria-labelledby="pending-users-title">
      <div className="admin-pending-hero">
        <div>
          <span className="admin-pending-signal-line" aria-hidden="true" />
          <p className="admin-technical-label">ACCESS CONTROL</p>
          <h2 id="pending-users-title">Pending Approval Queue</h2>
          <p>Review and authorize newly registered users before granting secure access to Warm Path Finder.</p>
        </div>
        <div className={`admin-pending-metric ${!loaded ? 'is-loading' : ''}`} aria-label={loaded ? `${users.length} pending requests` : 'Pending requests loading'}>
          <span><Radio size={13} aria-hidden="true" /> LIVE</span>
          <small>Pending Requests</small>
          {loaded ? <strong key={users.length}>{users.length}</strong> : <span className="admin-metric-placeholder" />}
        </div>
      </div>
      {!loaded ? (
        <div className="admin-queue-loading" role="status" aria-label="Synchronizing pending registrations">
          <div className="admin-empty-shield is-loading" aria-hidden="true"><span /><span /><ShieldCheck size={42} /></div>
          <span className="admin-loading-line is-wide" />
          <span className="admin-loading-line" />
          <small>Synchronizing secure review queue</small>
        </div>
      ) : null}
      {loaded && error ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {loaded && !error && !users.length ? (
        <div className="admin-pending-empty">
          <div className="admin-empty-shield" aria-hidden="true">
            <span /><span />
            <ShieldCheck size={42} />
          </div>
          <h3>No Pending Requests</h3>
          <p>All registration requests have been processed.</p>
          <p>New users awaiting approval will automatically appear here.</p>
          <div className="admin-queue-status">
            <small>SYSTEM STATUS</small>
            <strong><Check size={14} /> Queue synchronized</strong>
          </div>
        </div>
      ) : null}
      {users.length ? (
        <div className="admin-data-table-wrap">
          <table className="admin-data-table admin-pending-table">
            <thead><tr><th>User</th><th>Email</th><th>Contact</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((user) => {
                const busy = busyId === user.id
                return (
                  <tr key={user.id} className={busy ? 'is-processing' : ''}>
                    <td><div className="admin-user-cell"><span>{initials(user.full_name, user.email)}</span><strong>{user.full_name || 'Name unavailable'}</strong></div></td>
                    <td>{user.email || 'Not available'}</td>
                    <td>{user.contact_number || 'Not available'}</td>
                    <td>{formatDate(user.created_at)}</td>
                    <td><span className="admin-status-chip is-pending"><Clock3 size={13} /> Pending Review</span></td>
                    <td>
                      <button type="button" className="admin-primary-action" disabled={busy} onClick={() => onApprove(user)} aria-label={`Approve ${user.email}`}>
                        {busy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                        {busy ? 'Approving...' : 'Approve'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {users.length && !error ? <p className="admin-panel-footnote"><Check size={14} /> Approval immediately grants authorized dashboard access.</p> : null}
    </section>
  )
}
