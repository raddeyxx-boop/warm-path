import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

export function Login({ adminOnly = false }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const profileRole = auth.profile?.role

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated || !profileRole) return

    if (adminOnly && !auth.isAdmin) {
      navigate('/unauthorized', { replace: true })
      return
    }

    navigate(profileRole === 'admin' ? '/admin' : '/dashboard', { replace: true })
  }, [
    adminOnly,
    auth.isAdmin,
    auth.isAuthenticated,
    auth.isLoading,
    navigate,
    profileRole,
  ])

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError('')

    try {
      const result = await auth.signIn(email, password)
      const profile = result.profile
      if (!profile.is_active) {
        await auth.signOut()
        throw new Error('This account has been disabled.')
      }
      if (adminOnly && profile.role !== 'admin') {
        await auth.signOut()
        throw new Error('This account does not have administrator access.')
      }

      const requestedPath = location.state?.from?.pathname
      const destination = requestedPath && requestedPath !== location.pathname
        ? requestedPath
        : profile.role === 'admin'
          ? '/admin'
          : '/dashboard'

      navigate(destination, { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={`auth-page ${adminOnly ? 'auth-page-admin' : ''}`}>
      <button
        type="button"
        className={`button auth-route-button ${adminOnly ? 'button-secondary' : 'button-primary'}`}
        onClick={() => navigate(adminOnly ? '/login' : '/admin/login')}
      >
        {adminOnly ? 'Back' : 'Admin'}
      </button>
      <section className="auth-panel card">
        <div className="auth-form-wrap">
          <p className="eyebrow">INDPRO</p>
          <h1>{adminOnly ? 'Admin Access' : 'Welcome Back'}</h1>
          <p>{adminOnly ? 'Securely access the INDPRO management system.' : 'Sign in to continue managing high-value prospects.'}</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              <span className="sr-only">Email</span>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              <span className="sr-only">Password</span>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error ? <p className="form-message form-message-error" role="alert">{error}</p> : null}
            <button type="submit" className="button button-primary" disabled={submitting}>
              {submitting ? 'Signing in...' : adminOnly ? 'Login as admin' : 'Login'}
            </button>
          </form>
        </div>
        <aside className={`admin-login-side ${adminOnly ? '' : 'auth-marketing-side'}`}>
          <p className="admin-side-brand">INDPRO.</p>
          <h2>
            {adminOnly ? (
              <>
                <span>Admin</span>
                <span>Control Panel</span>
              </>
            ) : (
              <>
                <span>Find Your</span>
                <span>Next Best Lead</span>
              </>
            )}
          </h2>
          <p>
            {adminOnly
              ? 'Manage users, lead intelligence, uploads, and platform operations securely from one place.'
              : 'Identify high-value prospects, analyze real buying signals, and take action with confidence using intelligent lead insights.'}
          </p>
        </aside>
      </section>
    </main>
  )
}
