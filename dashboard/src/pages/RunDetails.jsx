import { Link, useParams } from 'react-router-dom'
import { StatusBadge } from '../components/Badge'
import { CandidateCard } from '../components/CandidateCard'
import { JsonSection } from '../components/JsonTree'
import { EmptyState, ErrorState, LoadingState } from '../components/StateBlocks'
import { useAsyncData } from '../hooks/useAsyncData'
import { usePageMeta } from '../hooks/usePageMeta'
import { getCandidatesForRun, getRunTargetSummary, getTopCandidatesForRun, getWorkflowRunById } from '../services/supabaseData'
import { fallback, formatDate, formatNumber } from '../utils/format'

function formatDuration(start, end) {
  if (!start || !end) return 'Not available'
  const startDate = new Date(start)
  const endDate = new Date(end)
  const diff = endDate.getTime() - startDate.getTime()
  if (!Number.isFinite(diff) || diff < 0) return 'Not available'
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`
}

export function RunDetails() {
  const { id } = useParams()
  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(async () => {
    const run = await getWorkflowRunById(id)
    const [related, topCandidates] = run
      ? await Promise.all([getCandidatesForRun(id), getTopCandidatesForRun(id)])
      : [{ data: [], field: null }, []]
    return { run, related, topCandidates }
  }, [id])
  usePageMeta(lastRefreshed, refresh)

  if (loading) return <LoadingState label="Loading workflow run..." />
  if (error) return <ErrorState message={error} onRetry={refresh} />
  if (!data?.run) return <EmptyState title="Workflow run not found" message="The selected run could not be found." />

  const { run, related, topCandidates } = data

  return (
    <div className="page-stack">
      <section className="card hero-card">
        <div>
          <p className="eyebrow">Workflow run</p>
          <h2>{fallback(getRunTargetSummary(run), 'Untitled run')}</h2>
          <p className="muted">
            {fallback(run.target_company)} · Created {formatDate(run.created_at || run.generated_at)}
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button button-secondary" to="/runs">
            Back to runs
          </Link>
          <StatusBadge value={run.status} />
        </div>
      </section>

      <section className="grid detail-grid">
        <Metric label="Total candidates" value={formatNumber(run.total_candidates)} />
        <Metric label="Top candidates" value={formatNumber(run.top_candidates_count)} />
        <Metric label="Average score" value={formatNumber(run.average_final_score)} />
        <Metric label="Created" value={formatDate(run.created_at || run.generated_at)} />
        <Metric label="Completed" value={formatDate(run.completed_at)} />
        <Metric label="Duration" value={formatDuration(run.created_at || run.generated_at, run.completed_at)} />
        <Metric label="Run ID" value={run.id} />
      </section>

      <section className="section section-dark">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Best ranked</p>
            <h2>Top Candidates ({topCandidates.length})</h2>
            <p className="muted">Linked through workflow_run_id and ordered by rank.</p>
          </div>
        </div>
        {topCandidates.length ? (
          <div className="grid cards-grid">
            {topCandidates.map((candidate, index) => (
              <CandidateCard candidate={candidate} prominent enableReasonFlip key={candidate.id || `${candidate.rank}-${index}`} />
            ))}
          </div>
        ) : (
          <EmptyState title="No top candidates linked" message="No top candidates were linked to this historical workflow run." />
        )}
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Related records</p>
            <h2>Candidates for this run</h2>
          </div>
        </div>
        {related.field ? (
          <p className="muted">Linked using {related.field}.</p>
        ) : (
          <p className="muted">No reliable workflow_run_id or run_id relationship was found for candidates.</p>
        )}
        {related.data.length ? (
          <div className="grid cards-grid">
            {related.data.map((candidate, index) => (
              <CandidateCard candidate={candidate} key={candidate.id || `${candidate.rank}-${index}`} />
            ))}
          </div>
        ) : null}
      </section>

      <JsonSection title="Target" value={{ person: run.target_person, company: run.target_company }} />
      <JsonSection title="Raw workflow run" value={run} />
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <article className="card metric-card">
      <span>{label}</span>
      <strong>{fallback(value)}</strong>
    </article>
  )
}
