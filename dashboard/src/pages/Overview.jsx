import { Activity, Award, Star, Target, Trophy, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CandidateCard } from '../components/CandidateCard'
import { EmptyState, ErrorState, LoadingState, SkeletonGrid } from '../components/StateBlocks'
import { StatusBadge } from '../components/Badge'
import { useAsyncData } from '../hooks/useAsyncData'
import { usePageMeta } from '../hooks/usePageMeta'
import { useWorkflowCompletionRefresh } from '../hooks/useWorkflowCompletionRefresh'
import { getDashboardStats, getRunTargetSummary } from '../services/supabaseData'
import { fallback, formatDate, formatNumber, formatScore } from '../utils/format'

const statCards = [
  { key: 'runs', label: 'Workflow runs', icon: Activity, note: 'Completed intelligence cycles' },
  { key: 'ranked', label: 'Ranked candidates', icon: Users, note: 'Valid candidates in scope' },
  { key: 'top', label: 'Top candidates', icon: Trophy, note: 'Highest-priority warm paths' },
  { key: 'averageScore', label: 'Average final score', icon: Target, score: true, note: 'Current candidate quality signal' },
  { key: 'strongRelationships', label: 'Strong relationships', icon: Star, note: 'Best relationship strength matches' },
  { key: 'highRecommendations', label: 'High recommendations', icon: Award, note: 'Candidates marked Strong' },
]

export function Overview() {
  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(getDashboardStats, [])
  usePageMeta(lastRefreshed, refresh)
  useWorkflowCompletionRefresh(refresh)

  if (loading) {
    return (
      <>
        <SkeletonGrid count={6} />
        <LoadingState label="Loading dashboard overview..." />
      </>
    )
  }

  if (error) return <ErrorState message={error} onRetry={refresh} />

  const totals = data?.totals || {}

  return (
    <div className="page-stack">
      <section className="overview-hero" aria-labelledby="overview-title">
        <div className="overview-hero-content">
          <p className="eyebrow">Relationship intelligence · candidate ranking · workflow insights</p>
          <h2 id="overview-title">
            Turn professional networks into <span className="text-accent">warmer paths.</span>
          </h2>
          <p>
            Warm Path Finder ranks candidates, evaluates relationship strength, and prepares personalized
            introductions so every outreach starts with context.
          </p>
        </div>
      </section>

      <section className="grid stats-grid" aria-label="Dashboard summary">
        {statCards.map((item) => {
          const Icon = item.icon
          const value = totals[item.key]
          return (
            <article className="card stat-card" key={item.key}>
              <Icon className="stat-icon" size={22} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{item.score ? formatScore(value) : formatNumber(value)}</strong>
              <small>{item.note}</small>
            </article>
          )
        })}
      </section>

      <section className="section section-dark">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Best ranked</p>
            <h2>Top Candidates ({data.topRows?.length || 0})</h2>
            <p className="muted">The three strongest current paths, ready for review and outreach.</p>
          </div>
          <Link className="button button-secondary" to="/top-candidates">
            View all top candidates
          </Link>
        </div>
        {data.topRows?.length ? (
          <div className="grid cards-grid">
            {data.topRows.map((candidate, index) => (
              <CandidateCard candidate={candidate} prominent enableReasonFlip key={candidate.id || `${candidate.rank}-${index}`} />
            ))}
          </div>
        ) : (
          <EmptyState title="No top candidates available" message="The top_candidates table has no readable rows yet." />
        )}
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>Workflow runs</h2>
            <p>Newest workflow output with target and candidate volume.</p>
          </div>
          <Link className="button button-secondary" to="/runs">
            View all runs
          </Link>
        </div>
        {data.recentRuns?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Candidates</th>
                  <th>Created</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.slice(0, 1).map((run) => (
                  <tr key={run.id}>
                    <td><StatusBadge value={run.status} /></td>
                    <td>{fallback(getRunTargetSummary(run))}</td>
                    <td>{formatNumber(run.total_candidates)}</td>
                    <td>{formatDate(run.created_at || run.generated_at)}</td>
                    <td>{formatDate(run.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No workflow runs available" message="The workflow_runs table has no readable rows yet." />
        )}
      </section>
    </div>
  )
}
