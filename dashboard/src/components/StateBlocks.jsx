import { AlertTriangle, Database, Inbox, Loader2 } from 'lucide-react'

export function LoadingState({ label = 'Loading data...' }) {
  return (
    <div className="state-block">
      <Loader2 className="spin" size={22} aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-block state-error" role="alert">
      <AlertTriangle size={24} aria-hidden="true" />
      <div>
        <h2>Could not load this view</h2>
        <p>{message}</p>
        {onRetry ? (
          <button type="button" className="button button-secondary" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function EmptyState({ title = 'No data available', message = 'There is nothing to show yet.' }) {
  return (
    <div className="state-block">
      <Inbox size={24} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </div>
  )
}

export function ConfigState({ message }) {
  return (
    <div className="state-block state-error" role="alert">
      <Database size={24} aria-hidden="true" />
      <div>
        <h2>Supabase is not configured</h2>
        <p>{message}</p>
      </div>
    </div>
  )
}

export function SkeletonGrid({ count = 3 }) {
  return (
    <div className="grid stats-grid" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <div className="card skeleton-card" key={index}>
          <span />
          <strong />
          <small />
        </div>
      ))}
    </div>
  )
}
