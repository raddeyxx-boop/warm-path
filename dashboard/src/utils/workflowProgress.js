const ACTIVE_STATES = new Set(['initialized', 'queued', 'starting', 'running', 'processing', 'in_progress'])
const FAILED_STATES = new Set(['failed', 'error'])
const CANCELLED_STATES = new Set(['cancelled', 'canceled', 'stopped'])
const TIMED_OUT_STATES = new Set(['timed_out', 'timeout'])

const STAGE_LABELS = {
  initialized: 'Preparing workflow...',
  queued: 'Waiting to start...',
  checking_cache: 'Checking for cached searches...',
  starting_search: 'Starting search...',
  linkedin_session_verified: 'LinkedIn session verified.',
  human_browsing: 'Preparing browser search...',
  searching_target: 'Searching for the target...',
  target_profile_opened: 'Target profile found.',
  extracting_target: 'Extracting target profile...',
  opening_connections: 'Opening mutual connections...',
  collecting_connections: 'Collecting mutual connections...',
  building_candidates: 'Building candidate profiles...',
  extraction_completed: 'Candidate extraction complete.',
  dispatching_to_n8n: 'Sending data for analysis...',
  processing_in_n8n: 'Processing results...',
  refreshing_cache: 'Refreshing results cache...',
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function clampedProgress(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(Math.min(100, Math.max(0, numeric)))
}

export function normalizeWorkflowStatus(value) {
  return normalizedText(value).toLowerCase().replace(/[\s-]+/g, '_')
}

export function getWorkflowProgressView(run = {}) {
  const status = normalizeWorkflowStatus(run.status)
  const stage = normalizeWorkflowStatus(run.current_step)
  const persistedProgress = clampedProgress(run.progress_percent)

  if (status === 'completed') {
    return { percentage: 100, label: 'Analysis complete.', state: 'completed' }
  }

  if (FAILED_STATES.has(status)) {
    return {
      percentage: Math.min(99, persistedProgress),
      label: normalizedText(run.n8n_dispatch_error) || normalizedText(run.current_message) || 'Workflow failed.',
      state: 'failed',
    }
  }

  if (CANCELLED_STATES.has(status)) {
    return { percentage: Math.min(99, persistedProgress), label: 'Cancelled', state: 'cancelled' }
  }

  if (TIMED_OUT_STATES.has(status)) {
    return { percentage: Math.min(99, persistedProgress), label: 'Timed out', state: 'timed_out' }
  }

  const label = STAGE_LABELS[stage] || normalizedText(run.current_message) ||
    (status === 'queued' ? 'Waiting to start...' : 'Preparing workflow...')

  return {
    percentage: ACTIVE_STATES.has(status) ? Math.min(99, persistedProgress) : persistedProgress,
    label,
    state: ACTIVE_STATES.has(status) ? 'running' : 'pending',
  }
}
