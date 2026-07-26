import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

export function Login({ adminOnly = false }) {
  const location = useLocation()
  const initialMode = adminOnly || location.state?.mode === 'login' ? 'login' : 'register'
  const [mode, setMode] = useState(initialMode)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const auth = useAuth()
  const navigate = useNavigate()

  function selectMode(nextMode) {
    if (submitting || adminOnly) return
    setMode(nextMode)
    setError('')
    setFieldErrors({})
  }

  function validateRegistration() {
    const errors = {}
    const normalizedName = fullName.trim()
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedContact = contactNumber.trim()
    if (!normalizedName) errors.fullName = 'Enter your full name.'
    else if (normalizedName.length > 120) errors.fullName = 'Full name must be 120 characters or fewer.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) errors.email = 'Enter a valid email address.'
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.'
    if (!normalizedContact) errors.contactNumber = 'Enter your contact number.'
    else if (!/^\+?[0-9][0-9\s().-]{5,30}$/.test(normalizedContact)) {
      errors.contactNumber = 'Enter a valid contact number, including the country code when applicable.'
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError('')
    setFieldErrors({})

    try {
      if (!adminOnly && mode === 'register') {
        if (!validateRegistration()) return
        const result = await auth.signUp({ fullName, email, password, contactNumber })
        navigate('/approval-pending', {
          replace: true,
          state: {
            email: email.trim().toLowerCase(),
            requiresEmailConfirmation: result.requiresEmailConfirmation,
          },
        })
        return
      }

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
      if (profile.approval_status === 'pending') {
        navigate('/approval-pending', { replace: true })
        return
      }
      if (profile.approval_status === 'rejected') {
        navigate('/account-rejected', { replace: true })
        return
      }
      if (profile.approval_status !== 'approved' && profile.role !== 'admin') {
        throw new Error('Your account authorization could not be verified. Please contact an administrator.')
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
    <main className={`auth-page ${adminOnly ? 'auth-page-admin admin-login-command-page' : 'auth-page-welcome'} ${mode === 'register' && !adminOnly ? 'auth-page-register' : ''} ${mode === 'login' && !adminOnly ? 'auth-page-login' : ''}`}>
      <button
        type="button"
        className={`button auth-route-button ${adminOnly ? 'button-secondary' : 'button-primary'}`}
        onClick={() => navigate(adminOnly ? '/login' : '/admin/login')}
      >
        {adminOnly ? 'Public Login' : 'Admin'}
      </button>
      <div className="auth-hero">
      <section className={`auth-panel card ${mode === 'register' && !adminOnly ? 'auth-panel-register' : ''} ${mode === 'login' && !adminOnly ? 'auth-panel-login' : ''}`} aria-labelledby="login-heading">
        <div className="auth-form-wrap">
          <p className="eyebrow auth-login-brand">
            <span className="auth-company-name">INDPRO</span>
            <span>{adminOnly ? 'SECURE ADMIN ACCESS' : 'WARM PATH'}</span>
          </p>
          <h1 id="login-heading">
            {adminOnly ? 'Administrator Sign In' : mode === 'register' ? 'Create Your Account' : 'Welcome Back'}
          </h1>
          <p>
            {adminOnly
              ? 'Authorized administrators only. Sign in to review registrations, manage accounts, and control platform access.'
              : mode === 'register'
                ? 'Register to request access to Warm Path Finder.'
                : 'Sign in to continue discovering your strongest warm connections.'}
          </p>
          {!adminOnly ? (
            <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'is-active' : ''}
                onClick={() => selectMode('register')}
              >
                Register
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'is-active' : ''}
                onClick={() => selectMode('login')}
              >
                Login
              </button>
            </div>
          ) : null}
          <form className={`auth-form ${mode === 'register' && !adminOnly ? 'auth-form-register' : ''} ${mode === 'login' && !adminOnly ? 'auth-form-login' : ''}`} onSubmit={handleSubmit}>
            {mode === 'register' && !adminOnly ? (
              <label>
                <span>Full Name</span>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  maxLength={120}
                  aria-invalid={Boolean(fieldErrors.fullName)}
                  aria-describedby={fieldErrors.fullName ? 'full-name-error' : undefined}
                  required
                />
                {fieldErrors.fullName ? <small id="full-name-error" className="field-error">{fieldErrors.fullName}</small> : null}
              </label>
            ) : null}
            <label>
              <span>Email Address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                required
              />
              {fieldErrors.email ? <small id="email-error" className="field-error">{fieldErrors.email}</small> : null}
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'register' && !adminOnly ? 'new-password' : 'current-password'}
                minLength={mode === 'register' && !adminOnly ? 8 : undefined}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                required
              />
              {fieldErrors.password ? <small id="password-error" className="field-error">{fieldErrors.password}</small> : null}
            </label>
            {mode === 'register' && !adminOnly ? (
              <label>
                <span>Contact Number</span>
                <input
                  type="tel"
                  value={contactNumber}
                  onChange={(event) => setContactNumber(event.target.value)}
                  autoComplete="tel"
                  maxLength={32}
                  aria-invalid={Boolean(fieldErrors.contactNumber)}
                  aria-describedby={fieldErrors.contactNumber ? 'contact-number-error' : undefined}
                  required
                />
                {fieldErrors.contactNumber ? <small id="contact-number-error" className="field-error">{fieldErrors.contactNumber}</small> : null}
              </label>
            ) : null}
            {mode === 'register' && !adminOnly ? (
              <p className="auth-approval-notice">New accounts require administrator approval before dashboard access is enabled.</p>
            ) : null}
            {error ? <p className="form-message form-message-error" role="alert">{error}</p> : null}
            <button type="submit" className="button button-primary" disabled={submitting} aria-busy={submitting}>
              {submitting
                ? mode === 'register' && !adminOnly ? 'Creating account...' : 'Signing in...'
                : adminOnly ? 'Sign In Securely' : mode === 'register' ? 'Register' : 'Login'}
            </button>
            {!adminOnly ? (
              <button
                type="button"
                className="auth-inline-action"
                onClick={() => selectMode(mode === 'register' ? 'login' : 'register')}
              >
                {mode === 'register' ? 'Already have an account? Login' : 'New user? Create an account'}
              </button>
            ) : null}
          </form>
        </div>
        <aside
          className="admin-login-side auth-marketing-side"
          tabIndex={0}
          aria-label={adminOnly ? 'Administrator access' : 'About Warm Path Finder'}
        >
          <div className="auth-network" aria-hidden="true">
            <span className="auth-network-line auth-network-line-one" />
            <span className="auth-network-line auth-network-line-two" />
            <span className="auth-network-node auth-network-node-one" />
            <span className="auth-network-node auth-network-node-two" />
            <span className="auth-network-node auth-network-node-three" />
            <span className="auth-network-node auth-network-node-four" />
            <span className="auth-network-node auth-network-node-five" />
            <span className="auth-network-node auth-network-node-six" />
            <span className="auth-network-node auth-network-node-seven" />
            <span className="auth-network-node auth-network-node-eight" />
          </div>
          <p className="admin-side-brand">WARM PATH FINDER</p>
          <h2>
            {adminOnly ? (
              <>
                <span>Identity</span>
                <span>Command Center</span>
              </>
            ) : (
              <>
                <span>Find the Warmest</span>
                <span>Path to Anyone</span>
              </>
            )}
          </h2>
          <p>
            {adminOnly
              ? 'A protected authorization channel for reviewing registrations and controlling platform access.'
              : 'Discover trusted connections, identify the strongest introducers, and reach the right people through meaningful relationships.'}
          </p>
          {adminOnly ? (
            <div className="admin-login-status">
              <span><ShieldCheck size={16} /> SECURE CHANNEL</span>
              <span><LockKeyhole size={16} /> AUTHENTICATION REQUIRED</span>
            </div>
          ) : null}
        </aside>
      </section>
      </div>
    </main>
  )
}
