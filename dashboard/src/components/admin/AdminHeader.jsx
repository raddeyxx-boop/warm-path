import { RefreshCcw, ShieldCheck } from 'lucide-react'

const SECTION_COPY = {
  pending: ['Registration Review Queue', 'Review newly registered accounts before granting dashboard access.'],
  add: ['Create Authorized Account', 'Create and activate a secure Warm Path Finder account.'],
  users: ['User Directory', 'Review approved accounts, roles, access status, and account history.'],
}

export function AdminHeader({ activeSection, loading, onRefresh, lastRefreshed }) {
  const [title, description] = SECTION_COPY[activeSection]
  return (
    <header className="admin-command-header">
      <div>
        <p className="admin-technical-label">SYSTEM CONTROL / IDENTITY MANAGEMENT</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="admin-header-actions">
        <span className="admin-secure-badge"><ShieldCheck size={15} /> ADMIN VERIFIED</span>
        <button type="button" className="admin-refresh-button" onClick={onRefresh} disabled={loading}>
          <RefreshCcw className={loading ? 'spin' : ''} size={17} aria-hidden="true" />
          Refresh
        </button>
        <small>{lastRefreshed ? `Last sync ${lastRefreshed}` : 'Synchronizing account data…'}</small>
      </div>
    </header>
  )
}
