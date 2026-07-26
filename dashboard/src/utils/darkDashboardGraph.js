import { encodeRouteKey, fallback, relationshipValue, safeJson } from './format.js'
import { buildRelationshipEvidenceItems, getRelationshipEvidence, normalizeRelationshipEvidence } from './topCandidateReason.js'
import { getWorkflowProgressView, normalizeWorkflowStatus } from './workflowProgress.js'

const ACTIVE_STATES = new Set(['initialized', 'queued', 'starting', 'running', 'processing', 'in_progress'])
const FAILED_STATES = new Set(['failed', 'error', 'cancelled', 'canceled', 'stopped', 'timed_out', 'timeout'])

/**
 * @typedef {'idle'|'loading'|'running'|'completed'|'no_path'|'failed'} WarmPathGraphState
 *
 * @typedef {Object} WarmPathConnectorView
 * @property {string} candidateId
 * @property {string} detailsUrl
 * @property {string} name
 * @property {number} rank
 * @property {number|null} score
 * @property {string|null} relationshipStrength
 * @property {string} position
 * @property {string} company
 * @property {Array<{key:string,label:string,value:string,text:string}>} evidence
 * @property {boolean} isPrimary
 *
 * @typedef {Object} WarmPathGraphView
 * @property {string|null} workflowRunId
 * @property {string|null} targetName
 * @property {WarmPathGraphState} state
 * @property {number|null} progress
 * @property {string|null} stageLabel
 * @property {WarmPathConnectorView[]} connectors
 * @property {'branching'|'single'|'none'} mode
 * @property {string} statusLabel
 * @property {string|null} runDetailsUrl
 * @property {string} accessibleSummary
 */

/**
 * Builds a truthful dark-dashboard graph from one selected workflow run.
 * Candidate rows are accepted only when their source workflow matches that run.
 *
 * @param {{recentRuns?:object[],topRows?:object[],candidateWorkflowRunId?:string|null}|null} data
 * @param {{loading?:boolean}} options
 * @returns {WarmPathGraphView}
 */
export function buildWarmPathGraphView(data, { loading = false } = {}) {
  const latestRun = data?.recentRuns?.[0] || null
  if (!latestRun) {
    return {
      workflowRunId: null,
      targetName: null,
      state: loading ? 'loading' : 'idle',
      progress: null,
      stageLabel: loading ? 'Synchronizing network' : null,
      connectors: [],
      mode: 'none',
      statusLabel: loading ? 'SYNCHRONIZING NETWORK' : 'AWAITING TARGET',
      runDetailsUrl: null,
      accessibleSummary: loading
        ? 'The latest relationship analysis is loading.'
        : 'No target has been analyzed yet.',
    }
  }

  const workflowRunId = String(latestRun.id)
  const targetName = resolveTargetName(latestRun)
  const status = normalizeWorkflowStatus(latestRun.status)
  const progressView = getWorkflowProgressView(latestRun)
  const runDetailsUrl = `/runs/${workflowRunId}`

  if (ACTIVE_STATES.has(status)) {
    return {
      workflowRunId,
      targetName,
      state: 'running',
      progress: progressView.percentage,
      stageLabel: progressView.label,
      connectors: [],
      mode: 'none',
      statusLabel: 'ANALYSIS IN PROGRESS',
      runDetailsUrl,
      accessibleSummary: `Analysis is in progress${targetName ? ` for ${targetName}` : ''} at ${progressView.percentage} percent.`,
    }
  }

  if (FAILED_STATES.has(status)) {
    return {
      workflowRunId,
      targetName,
      state: 'failed',
      progress: progressView.percentage,
      stageLabel: progressView.label,
      connectors: [],
      mode: 'none',
      statusLabel: 'ANALYSIS INTERRUPTED',
      runDetailsUrl,
      accessibleSummary: `The latest analysis${targetName ? ` for ${targetName}` : ''} was interrupted.`,
    }
  }

  const candidatesMatchRun = status === 'completed' &&
    String(data?.candidateWorkflowRunId || '') === workflowRunId
  const connectors = candidatesMatchRun
    ? (data?.topRows || []).slice(0, 2).map(toConnectorView)
    : []

  if (status === 'completed' && connectors.length) {
    const primary = connectors[0]
    return {
      workflowRunId,
      targetName,
      state: 'completed',
      progress: 100,
      stageLabel: 'Analysis complete',
      connectors,
      mode: connectors.length > 1 ? 'branching' : 'single',
      statusLabel: 'WARM PATH IDENTIFIED',
      runDetailsUrl,
      accessibleSummary: `The latest completed analysis targeted ${targetName || 'the selected target'}. ${primary.name} is the highest-ranked connector${primary.score === null ? '' : ` with a score of ${Math.round(primary.score)}`}${primary.relationshipStrength ? ` and ${primary.relationshipStrength} relationship strength` : ''}.`,
    }
  }

  return {
    workflowRunId,
    targetName,
    state: status === 'completed' ? 'no_path' : 'idle',
    progress: status === 'completed' ? 100 : progressView.percentage,
    stageLabel: status === 'completed' ? 'Analysis complete' : progressView.label,
    connectors: [],
    mode: 'none',
    statusLabel: status === 'completed' ? 'NO VERIFIED PATH' : 'AWAITING TARGET',
    runDetailsUrl,
    accessibleSummary: status === 'completed'
      ? `The latest analysis${targetName ? ` for ${targetName}` : ''} did not identify a verified warm path.`
      : 'No active target analysis is available.',
  }
}

function toConnectorView(candidate, index) {
  const numericRank = Number(candidate.rank)
  const numericScore = Number(candidate.final_score)
  const evidence = buildRelationshipEvidenceItems(
    normalizeRelationshipEvidence(getRelationshipEvidence(candidate)),
    candidate,
  ).slice(0, 3)

  return {
    candidateId: String(candidate.candidate_id || candidate.id || encodeRouteKey(candidate)),
    detailsUrl: `/candidates/${encodeRouteKey(candidate)}`,
    name: cleanText(candidate.name) || 'Unnamed connector',
    rank: Number.isFinite(numericRank) ? numericRank : index + 1,
    score: Number.isFinite(numericScore) ? numericScore : null,
    relationshipStrength: cleanNullable(relationshipValue(candidate)),
    position: cleanText(candidate.position || candidate.role || candidate.headline),
    company: cleanText(candidate.current_company || candidate.company),
    evidence,
    isPrimary: index === 0,
  }
}

function cleanText(value) {
  const text = fallback(value, '')
  return text === 'Not available' ? '' : text.replace(/\s+/g, ' ').trim()
}

function cleanNullable(value) {
  return cleanText(value) || null
}

function resolveTargetName(run) {
  const directName = cleanText(run?.target_person)
  if (directName) return directName

  const company = cleanText(run?.target_company)
  if (company) return company

  const target = safeJson(run?.target) || run?.target
  if (typeof target === 'string') return cleanText(target) || null
  return cleanText(target?.name) || null
}
