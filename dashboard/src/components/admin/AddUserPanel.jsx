import { KeyRound, Loader2, ShieldCheck, UserPlus } from 'lucide-react'

export function AddUserPanel({ creating, error, form, message, onChange, onSubmit }) {
  return (
    <section className="admin-glass-panel admin-section-panel" aria-labelledby="add-user-title">
      <div className="admin-panel-heading">
        <div>
          <p className="admin-technical-label">ACCOUNT PROVISIONING</p>
          <h2 id="add-user-title">Add User</h2>
          <p>Create a new authorized Warm Path Finder account.</p>
        </div>
        <span className="admin-count-badge"><UserPlus size={15} /> Secure Creation</span>
      </div>
      <form className="admin-command-form" onSubmit={onSubmit}>
        <label><span>Full Name</span><input value={form.fullName} onChange={(event) => onChange('fullName', event.target.value)} autoComplete="name" disabled={creating} required /></label>
        <label><span>Email</span><input type="email" value={form.email} onChange={(event) => onChange('email', event.target.value)} autoComplete="email" disabled={creating} required /></label>
        <label><span>Password</span><input type="password" value={form.password} onChange={(event) => onChange('password', event.target.value)} autoComplete="new-password" minLength={8} disabled={creating} required /></label>
        <label><span>Contact Number</span><input type="tel" value={form.contactNumber} onChange={(event) => onChange('contactNumber', event.target.value)} autoComplete="tel" disabled={creating} /></label>
        <label><span>Role</span><select value={form.role} onChange={(event) => onChange('role', event.target.value)} disabled={creating}><option value="user">User</option><option value="admin">Admin</option></select></label>
        <div className="admin-authorization-summary">
          <ShieldCheck size={19} aria-hidden="true" />
          <p><strong>Immediate authorization</strong><span>Administrator-created accounts are activated immediately.</span></p>
        </div>
        <button type="submit" className="admin-primary-action admin-create-action" disabled={creating}>
          {creating ? <Loader2 className="spin" size={17} /> : <KeyRound size={17} />}
          {creating ? 'Creating account...' : 'Create Authorized Account'}
        </button>
      </form>
      {message ? <p className="admin-feedback is-success" role="status">{message}</p> : null}
      {error ? <p className="admin-feedback is-error" role="alert">{error}</p> : null}
    </section>
  )
}
