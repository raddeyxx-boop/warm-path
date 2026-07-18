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

export function Runs() {
  const [, setClock] = useState(Date.now())
  const pagination = usePagination(25)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('newest')
  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(
    () => getWorkflowRuns({ page: pagination.page, pageSize: pagination.pageSize, search, status, sort }),
    [pagination.page, pagination.pageSize, search, status, sort],
  )
  usePageMeta(lastRefreshed, refresh)

  const hasActiveRuns = (data?.data || []).some((run) => ['queued', 'running'].includes(run.status))

  useEffect(() => {
    const stopRealtime = subscribeWorkflowRuns(refresh)
    return stopRealtime
  }, [refresh])

  useEffect(() => {
    if (!hasActiveRuns) return undefined
    const timer = setInterval(() => {
      setClock(Date.now())
      refresh()
    }, 2000)
    return () => clearInterval(timer)
  }, [hasActiveRuns, refresh])

  const statuses = useMemo(() => {
    return [...new Set((data?.data || []).map((run) => run.status).filter(Boolean).map(String))].sort()
  }, [data])

  return (
    <section className="page-stack">
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
          <div className="table-wrap">
            <table>
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
                {data.data.map((run) => (
                  <tr key={run.id}>
                    <td><div className="card-actions"><StatusBadge value={run.status} />{run.cache_hit ? <Badge tone="info">Cached</Badge> : null}</div></td>
                    <td>{fallback(getRunTargetSummary(run))}</td>
                    <td>{formatNumber(run.total_candidates)}</td>
                    <td>
                      <div className="workflow-progress">
                        <div className="workflow-progress-label"><strong>{run.current_message || run.current_step || run.status}</strong><span>{run.progress_percent || 0}%</span></div>
                        <progress max="100" value={run.progress_percent || 0}>{run.progress_percent || 0}%</progress>
                        <WorkflowStats run={run} />
                      </div>
                    </td>
                    <td>
                      <small>Started {formatDate(run.started_at || run.created_at)}</small><br />
                      <small>Elapsed {elapsedLabel(run.started_at || run.created_at, run.completed_at)}</small><br />
                      {run.estimated_remaining_seconds != null ? <small>About {durationLabel(run.estimated_remaining_seconds)} remaining</small> : null}
                    </td>
                    <td><Link className="button button-secondary" to={`/runs/${run.id}`}>View details</Link></td>
                  </tr>
                ))}
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

function WorkflowStats({ run }) {
  const stats = [
    ['Profiles found', run.profiles_found], ['Profiles processed', run.profiles_processed],
    ['Mutual connections', run.mutual_connections], ['Candidates ranked', run.candidates_ranked],
    ['AI analyses', run.ai_analyses_completed],
  ].filter(([, value]) => value != null)
  if (!stats.length) return null
  return <div className="workflow-stats">{stats.map(([label, value]) => <span key={label}>{label}: {formatNumber(value)}</span>)}</div>
}
