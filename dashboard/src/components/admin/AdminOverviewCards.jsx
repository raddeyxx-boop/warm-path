import { Clock3, ShieldCheck, UserRoundCheck, Users } from 'lucide-react'

export function AdminOverviewCards({ pendingCount, approvedCount, totalCount, recentCount }) {
  const cards = [
    { label: 'Pending Review', value: pendingCount, icon: Clock3, tone: 'pending' },
    { label: 'Approved Users', value: approvedCount, icon: UserRoundCheck, tone: 'success' },
    { label: 'Total Accounts', value: totalCount, icon: Users, tone: 'cyan' },
    { label: 'Recently Added', value: recentCount, icon: ShieldCheck, tone: 'cyan' },
  ]
  return (
    <section className="admin-overview-grid" aria-label="Account summary">
      {cards.map(({ label, value, icon: Icon, tone }) => (
        <article className={`admin-overview-card is-${tone} ${value === null ? 'is-loading' : ''}`} key={label} aria-busy={value === null}>
          <div><Icon size={18} aria-hidden="true" /><span>{label}</span></div>
          {value === null ? <span className="admin-count-placeholder" aria-label={`${label} loading`} /> : <strong>{value}</strong>}
          <small>{value === null ? 'SYNCING PROFILE DATA' : 'LIVE PROFILE DATA'}</small>
        </article>
      ))}
    </section>
  )
}
