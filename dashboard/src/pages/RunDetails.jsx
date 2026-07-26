import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { StatusBadge } from '../components/Badge'
import { CandidateCard } from '../components/CandidateCard'
import { JsonSection } from '../components/JsonTree'
import { EmptyState, ErrorState, LoadingState } from '../components/StateBlocks'
import { useAsyncData } from '../hooks/useAsyncData'
import { usePageMeta } from '../hooks/usePageMeta'
import { getCandidatesForRun, getRunTargetSummary, getTopCandidatesForRun, getWorkflowRunById, subscribeWorkflowRuns } from '../services/supabaseData'
import { fallback, formatDate, formatNumber } from '../utils/format'
import { deleteWorkflow, stopWorkflow } from '../services/workflowService'

const ACTIVE_WORKFLOW_STATUSES = new Set(['running', 'starting', 'processing', 'in_progress'])

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
  const navigate = useNavigate()
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const stoppingRef = useRef(false)
  const [stopMessage, setStopMessage] = useState('')
  const [stopError, setStopError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const [deleteError, setDeleteError] = useState('')
  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(async () => {
    const run = await getWorkflowRunById(id)
    const [related, topCandidates] = run
      ? await Promise.all([getCandidatesForRun(id), getTopCandidatesForRun(id)])
      : [{ data: [], field: null }, []]
    return { run, related, topCandidates }
  }, [id])
  usePageMeta(lastRefreshed, refresh)
  useEffect(() => subscribeWorkflowRuns(() => { void refresh() }, { workflowRunId: id }), [id, refresh])

  if (loading) return <LoadingState label="Loading workflow run..." />
  if (error) return <ErrorState message={error} onRetry={refresh} />
  if (!data?.run) return <EmptyState title="Workflow run not found" message="The selected run could not be found." />

  const { run, related, topCandidates } = data
  const canStop = ACTIVE_WORKFLOW_STATUSES.has(String(run.status || '').toLowerCase())

  async function handleStop() {
    if (stoppingRef.current || !canStop) return
    stoppingRef.current = true
    setStopping(true)
    setStopError('')
    try {
      const result = await stopWorkflow(run.id)
      setStopMessage(result.message || 'Workflow stopped by user.')
      setConfirmStop(false)
      await refresh()
    } catch (stopFailure) {
      setStopError(stopFailure.message || 'Unable to stop the workflow.')
    } finally {
      stoppingRef.current = false
      setStopping(false)
    }
  }

  async function handleDelete() {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteWorkflow(run.id)
      navigate('/runs', { replace: true, state: { workflowDeleted: run.id } })
    } catch (deleteFailure) {
      setDeleteError(deleteFailure.message || 'Unable to delete the workflow run.')
      setConfirmDelete(false)
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

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
          {canStop ? (
            <button type="button" className="button button-danger button-pill" onClick={() => setConfirmStop(true)} disabled={stopping}>
              {stopping ? 'Stopping...' : 'Stop'}
            </button>
          ) : null}
          <button type="button" className="button button-danger button-pill" onClick={() => {
            setDeleteError('')
            setConfirmDelete(true)
          }} disabled={deleting || stopping}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </section>

      {stopMessage ? <p className="form-message form-message-success" role="status">{stopMessage}</p> : null}
      {stopError ? <p className="form-message form-message-error" role="alert">{stopError}</p> : null}
      {deleteError ? <p className="form-message form-message-error" role="alert">{deleteError}</p> : null}

      {confirmStop ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !stopping) setConfirmStop(false)
        }}>
          <section className="card confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="stop-workflow-title">
            <h2 id="stop-workflow-title">Stop workflow?</h2>
            <p>Are you sure you want to stop this workflow? Any data already collected will be preserved.</p>
            <div className="card-actions confirmation-actions">
              <button type="button" className="button button-secondary" disabled={stopping} onClick={() => setConfirmStop(false)}>Cancel</button>
              <button type="button" className="button button-danger" disabled={stopping} onClick={handleStop}>
                {stopping ? 'Stopping...' : 'Stop workflow'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <DeleteRunDialog
        open={confirmDelete}
        runId={run.id}
        isDeleting={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />

      <section className="grid detail-grid">
        <Metric label="Total candidates" value={formatNumber(run.total_candidates)} />
        <Metric label="Top candidates" value={formatNumber(run.top_candidates_count)} />
        <Metric label="Average score" value={formatNumber(run.average_final_score)} />
        <Metric label="Created" value={formatDate(run.created_at || run.generated_at)} />
        <Metric label="Finished" value={formatDate(run.finished_at || run.completed_at)} />
        <Metric label="Duration" value={formatDuration(run.created_at || run.generated_at, run.finished_at || run.completed_at)} />
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

function DeleteRunDialog({ open, runId, isDeleting, onCancel, onConfirm }) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape' && !isDeleting) onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, isDeleting, onCancel])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="modal-backdrop delete-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isDeleting) onCancel()
    }}>
      <section
        className="card confirmation-dialog delete-confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-workflow-title"
        aria-describedby="delete-workflow-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="delete-workflow-title">Permanently delete workflow run?</h2>
        <p id="delete-workflow-description">
          This permanently deletes this workflow run and all related candidates, search records, and cached results. This action cannot be undone.
        </p>
        <p className="delete-workflow-id"><strong>Run ID:</strong> {runId}</p>
        <div className="card-actions confirmation-actions">
          <button type="button" className="button button-secondary" disabled={isDeleting} onClick={onCancel}>Cancel</button>
          <button type="button" className="button button-danger" disabled={isDeleting} onClick={onConfirm}>
            {isDeleting ? 'Deleting permanently...' : 'Delete permanently'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
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
