import { fallback, gradeClass, statusClass } from '../utils/format'

export function Badge({ children, tone = 'muted' }) {
  return <span className={`badge badge-${tone}`}>{fallback(children)}</span>
}

export function GradeBadge({ value }) {
  return <span className={`badge ${gradeClass(value)}`}>{fallback(value)}</span>
}

export function StatusBadge({ value }) {
  return <span className={`badge ${statusClass(value)}`}>{fallback(value)}</span>
}
