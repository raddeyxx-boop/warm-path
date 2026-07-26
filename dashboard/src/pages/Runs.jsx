import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, StatusBadge } from '../components/Badge'
import { Pagination } from '../components/Pagination'
import { EmptyState, ErrorState, LoadingState } from '../components/StateBlocks'
import { useAsyncData } from '../hooks/useAsyncData'
import { usePagination } from '../hooks/usePagination'
import { usePageMeta } from '../hooks/usePageMeta'
import { getRunTargetSummary, getWorkflowRuns, subscribeWorkflowRuns } from '../services/supabaseData'
import { fallback, formatDate, formatNumber } from '../utils/format'
import { getWorkflowProgressView } from '../utils/workflowProgress'

export function Runs() {
  const pagination = usePagination(25)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('newest')
  const [, setClock] = useState(Date.now())
  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(
    () => getWorkflowRuns({ page: pagination.page, pageSize: pagination.pageSize, search, status, sort }),
    [pagination.page, pagination.pageSize, search, status, sort],
  )
  usePageMeta(lastRefreshed, refresh)

  useEffect(() => {
    const hasActiveRun = (data?.data || []).some((run) => ['initialized', 'queued', 'running', 'processing', 'in_progress'].includes(run.status))
    if (!hasActiveRun) return undefined
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [data])

  useEffect(() => {
    if (error) return undefined
    return subscribeWorkflowRuns(() => {
      void refresh()
    })
  }, [error, refresh])

  const statuses = useMemo(() => {
    return [...new Set((data?.data || []).map((run) => run.status).filter(Boolean).map(String))].sort()
  }, [data])

  return (
    <section className="page-stack workflow-runs-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Workflow history</p>
          <h2>Workflow Runs</h2>
          <p>Review completed runs, target context, candidate volume, and linked report details.</p>
        </div>
      </div>

      <div className="toolbar card">
        <label className="search-field">
          <span>Search workflow runs</span>
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => {
              pagination.resetPage()
              setSearch(event.target.value)
            }}
            placeholder="Search target or status..."
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>

      {loading ? <LoadingState label="Loading workflow runs..." /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!loading && !error && data?.data?.length ? (
        <>
          <div className="table-wrap workflow-runs-table-wrap">
            <table className="workflow-runs-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Candidates</th>
                  <th>Progress</th>
                  <th>Timing</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((run) => {
                  const progressView = getWorkflowProgressView(run)
                  return <tr key={run.id}>
                    <td><div className="card-actions"><StatusBadge value={run.status} />{run.cache_hit ? <Badge tone="info">Cached</Badge> : null}</div></td>
                    <td>{fallback(getRunTargetSummary(run))}</td>
                    <td>{formatNumber(run.total_candidates ?? 0)}</td>
                    <td>
                      <div className="workflow-progress">
                        <div className="workflow-progress-label"><strong>{progressView.label}</strong><span>{progressView.percentage}%</span></div>
                        <progress max="100" value={progressView.percentage}>{progressView.percentage}%</progress>
                        <WorkflowStats run={run} />
                      </div>
                    </td>
                    <td>
                      <small>Started {formatDate(run.started_at || run.created_at)}</small><br />
                      <small>{timingLabel(run)}</small><br />
                      {remainingLabel(run) ? <small>{remainingLabel(run)}</small> : null}
                    </td>
                    <td><Link className="button button-secondary" to={`/runs/${run.id}`}>{actionLabel(progressView.state)}</Link></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={data.count || 0}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </>
      ) : null}
      {!loading && !error && !data?.data?.length ? (
        <EmptyState title="No workflow runs available" message="No rows are readable from workflow_runs." />
      ) : null}
    </section>
  )
}

function durationLabel(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  if (value < 60) return `${Math.round(value)} sec`
  return `${Math.ceil(value / 60)} min`
}

function elapsedLabel(start, end) {
  const started = Date.parse(start || '')
  if (!Number.isFinite(started)) return 'Not available'
  return durationLabel(((end ? Date.parse(end) : Date.now()) - started) / 1000)
}

function actionLabel(state) {
  if (state === 'completed') return 'View results'
  if (state === 'failed') return 'View details'
  return 'View details'
}

function timingLabel(run) {
  const start = run.started_at || run.created_at
  if (run.status === 'completed') return `Completed in ${elapsedLabel(start, run.completed_at)}`
  if (run.status === 'failed') return `Stopped after ${elapsedLabel(start, run.failed_at || run.updated_at)}`
  if (['cancelled', 'canceled', 'stopped'].includes(run.status)) return `Cancelled after ${elapsedLabel(start, run.finished_at || run.updated_at)}`
  if (['timed_out', 'timeout'].includes(run.status)) return `Timed out after ${elapsedLabel(start, run.failed_at || run.updated_at)}`
  return `Elapsed ${elapsedLabel(start)}`
}

function remainingLabel(run) {
  if (!['running', 'processing', 'in_progress'].includes(run.status)) return ''
  const remaining = Number(run.estimated_remaining_seconds)
  if (!Number.isFinite(remaining) || remaining < 0) return ''
  return `Estimated ${durationLabel(remaining)} remaining`
}

function WorkflowStats({ run }) {
  const stats = [
    ['Profiles found', run.profiles_found], ['Profiles processed', run.profiles_processed],
    ['Mutual connections', run.mutual_connections], ['Candidates ranked', run.candidates_ranked],
    ['AI analyses', run.ai_analyses_completed],
  ].filter(([, value]) => value != null)
  if (!stats.length) return null
  return <div className="workflow-stats">{stats.map(([label, value]) => <span key={label}>{label}: {formatNumber(value)}</span>)}</div>
}
