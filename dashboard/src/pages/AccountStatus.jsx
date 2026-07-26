import { Check, Circle, LogIn, Radar, RefreshCcw, ShieldCheck, ShieldX } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

function formatRequestDate(value) {
  if (!value) return 'Recently submitted'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently submitted'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function MissionVisual() {
  return (
    <aside className="approval-mission-visual" aria-hidden="true">
      <div className="approval-orbit approval-orbit-one" />
      <div className="approval-orbit approval-orbit-two" />
      <div className="approval-hologram-core">
        <ShieldCheck />
      </div>
      <div className="approval-network-line approval-network-line-one" />
      <div className="approval-network-line approval-network-line-two" />
      <div className="approval-network-line approval-network-line-three" />
      {Array.from({ length: 7 }, (_, index) => (
        <span key={index} className={`approval-network-node approval-network-node-${index + 1}`} />
      ))}
      <p>SECURE REVIEW CHANNEL</p>
      <strong>AUTHORIZATION<br />IN PROGRESS</strong>
    </aside>
  )
}

export function AccountStatus({ status }) {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState('')
  const pending = status === 'pending'
  const email = auth.user?.email || location.state?.email || 'Account email unavailable'
  const createdAt = auth.profile?.created_at || location.state?.submittedAt

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMessage('')
    try {
      const profile = await auth.refreshProfile()
      if (profile?.role === 'admin' || profile?.approval_status === 'approved') {
        navigate(profile.role === 'admin' ? '/admin' : '/dashboard', { replace: true })
        return
      }
      setRefreshMessage('Still waiting for administrator approval.')
    } catch {
      setRefreshMessage('Status could not be refreshed. Please try again.')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleExit() {
    if (auth.isAuthenticated) await auth.signOut()
    navigate('/login', { replace: true, state: { mode: 'login' } })
  }

  return (
    <main className={`account-status-page approval-command-page ${pending ? '' : 'approval-command-page-rejected'}`}>
      <div className="approval-stars" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
      </div>
      <div className="approval-grid" aria-hidden="true" />

      <div className="approval-command-layout">
        <section className="approval-glass-panel" aria-labelledby="account-status-heading">
          <header className="approval-panel-header">
            <div className={`approval-scanner ${pending ? '' : 'approval-scanner-rejected'}`} aria-hidden="true">
              <span className="approval-scanner-ring approval-scanner-ring-outer" />
              <span className="approval-scanner-ring approval-scanner-ring-inner" />
              <span className="approval-scanner-sweep" />
              {pending ? <Radar size={38} /> : <ShieldX size={38} />}
            </div>
            <p className="approval-brand"><strong>INDPRO</strong><span>WARM PATH FINDER</span></p>
            <div className={`approval-status-chip ${pending ? '' : 'is-rejected'}`}>
              <span className="approval-status-dot" />
              <small>STATUS</small>
              <strong>{pending ? 'PENDING REVIEW' : 'NOT APPROVED'}</strong>
            </div>
          </header>

          <h1 id="account-status-heading">
            {pending ? 'Approval in Progress' : 'Account Request Not Approved'}
          </h1>
          <span className="approval-title-line" aria-hidden="true" />

          <div className="approval-description">
            {pending ? (
              <>
                <p>Your account has been created successfully.</p>
                <p>Our administrators are reviewing your registration.</p>
                <p>You&apos;ll receive access immediately after approval.</p>
              </>
            ) : (
              <p>Your registration request was not approved. Please contact an administrator if you believe this was a mistake.</p>
            )}
          </div>

          {pending ? (
            <ol className="approval-timeline" aria-label="Account approval progress">
              <li className="is-complete"><span><Check /></span><strong>Registration Complete</strong></li>
              <li className="is-current"><span><Radar /></span><strong>Waiting for Administrator Review</strong></li>
              <li><span><Circle /></span><strong>Account Activation</strong></li>
            </ol>
          ) : null}

          <dl className="approval-account-grid">
            <div><dt>Email</dt><dd>{email}</dd></div>
            <div><dt>Created</dt><dd>{formatRequestDate(createdAt)}</dd></div>
            <div><dt>Status</dt><dd>{pending ? 'Pending Review' : 'Not Approved'}</dd></div>
            <div><dt>Request</dt><dd>{pending ? 'Successfully Submitted' : 'Review Completed'}</dd></div>
          </dl>

          <div className="approval-notice">
            <ShieldCheck aria-hidden="true" />
            <p>
              <strong>Email verification and administrator approval are independent processes.</strong>
              If you receive a verification email, please confirm it.
            </p>
          </div>

          <div className="approval-actions">
            <button type="button" className="button approval-primary-action" onClick={handleExit}>
              <LogIn size={17} aria-hidden="true" />
              Return to Login
            </button>
            {pending ? (
              <button
                type="button"
                className="button approval-secondary-action"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-busy={refreshing}
              >
                <RefreshCcw size={17} aria-hidden="true" />
                {refreshing ? 'Checking Status...' : 'Refresh Status'}
              </button>
            ) : null}
          </div>
          <p className="approval-refresh-message" role="status" aria-live="polite">{refreshMessage}</p>
        </section>

        <MissionVisual />
      </div>
    </main>
  )
}
