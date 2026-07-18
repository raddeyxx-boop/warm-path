import { Link } from 'react-router-dom'

export function Unauthorized() {
  return (
    <main className="auth-page">
      <section className="auth-panel card auth-panel-simple">
        <p className="eyebrow">Access denied</p>
        <h1>Unauthorized</h1>
        <p>Your account does not have permission to view this page.</p>
        <div className="card-actions">
          <Link className="button button-primary" to="/dashboard">Go to dashboard</Link>
          <Link className="button button-secondary" to="/login">Back to login</Link>
        </div>
      </section>
    </main>
  )
}
