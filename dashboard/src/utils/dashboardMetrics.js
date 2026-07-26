import { countStrongRelationships } from './relationshipStrength.js'

/**
 * @typedef {Object} DashboardMetrics
 * @property {number|null} runs
 * @property {number|null} ranked
 * @property {number|null} top
 * @property {number|null} averageScore
 * @property {number|null} strongRelationships
 */

export const DASHBOARD_METRIC_DEFINITIONS = Object.freeze([
  { key: 'runs', label: 'Workflow runs', note: 'Completed intelligence cycles', icon: 'activity' },
  { key: 'ranked', label: 'Ranked candidates', note: 'Valid candidates in scope', icon: 'users' },
  { key: 'top', label: 'Top candidates', note: 'Highest-priority warm paths', icon: 'trophy' },
  { key: 'averageScore', label: 'Average final score', note: 'Current candidate quality signal', icon: 'target', score: true },
  { key: 'strongRelationships', label: 'Strong relationships', note: 'Best relationship strength matches', icon: 'star' },
])

/**
 * @param {{workflowRunId?:string|null,workflowRuns?:number|null,rankedCandidates?:object[]|null,topCandidates?:object[]|null}} input
 * @returns {DashboardMetrics}
 */
export function calculateDashboardMetrics({
  workflowRunId = null,
  workflowRuns = null,
  rankedCandidates = null,
  topCandidates = null,
} = {}) {
  const ranked = rankedCandidates === null ? null : deduplicateCandidates(filterWorkflow(rankedCandidates, workflowRunId))
  const top = topCandidates === null ? null : deduplicateCandidates(filterWorkflow(topCandidates, workflowRunId))
  const workflowCount = normalizeCount(workflowRuns)
  const rankedCount = ranked?.length ?? null
  const rawTopCount = top?.length ?? null
  const topCount = rawTopCount === null || rankedCount === null ? rawTopCount : Math.min(rawTopCount, rankedCount)
  const scores = ranked?.map((candidate) => normalizeScore(candidate?.final_score))
    .filter((score) => score !== null) ?? null
  const averageScore = scores === null || !scores.length
    ? null
    : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)

  const metrics = {
    runs: workflowCount,
    ranked: rankedCount,
    top: topCount,
    averageScore,
    strongRelationships: ranked === null ? null : countStrongRelationships(ranked),
  }

  if (import.meta.env?.DEV) validateDashboardMetrics(metrics, { rawTopCount })
  return metrics
}

export function formatDashboardMetricValue(value, { score = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const numeric = Number(value)
  return score ? Math.round(numeric).toString() : new Intl.NumberFormat().format(numeric)
}

export function deduplicateCandidates(candidates) {
  const seen = new Set()
  return (candidates || []).filter((candidate, index) => {
    const key = candidateKey(candidate, index)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function candidateKey(candidate, index) {
  if (candidate?.id !== null && candidate?.id !== undefined && candidate.id !== '') return `id:${candidate.id}`
  if (candidate?.candidate_id !== null && candidate?.candidate_id !== undefined && candidate.candidate_id !== '') {
    return `candidate:${candidate.workflow_run_id || ''}:${candidate.candidate_id}`
  }
  if (candidate?.linkedin_url) return `linkedin:${candidate.workflow_run_id || ''}:${candidate.linkedin_url}`
  return `row:${index}`
}

function filterWorkflow(candidates, workflowRunId) {
  if (!workflowRunId) return candidates || []
  return (candidates || []).filter((candidate) =>
    String(candidate?.workflow_run_id || candidate?.run_id || '') === String(workflowRunId))
}

function normalizeScore(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
  if (typeof value !== 'string' || !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null
}

function normalizeCount(value) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null
}

function validateDashboardMetrics(metrics, { rawTopCount }) {
  const warnings = []
  if (metrics.runs !== null && (!Number.isInteger(metrics.runs) || metrics.runs < 0)) warnings.push('workflow count is invalid')
  if (metrics.ranked !== null && !Number.isInteger(metrics.ranked)) warnings.push('ranked candidate count is invalid')
  if (metrics.top !== null && !Number.isInteger(metrics.top)) warnings.push('top candidate count is invalid')
  if (metrics.strongRelationships !== null && !Number.isInteger(metrics.strongRelationships)) warnings.push('strong relationship count is invalid')
  if (metrics.averageScore !== null && !Number.isFinite(metrics.averageScore)) warnings.push('average score is invalid')
  if (metrics.ranked !== null && rawTopCount !== null && rawTopCount > metrics.ranked) warnings.push('top candidate count exceeds ranked candidates')
  if (metrics.ranked !== null && metrics.strongRelationships !== null && metrics.strongRelationships > metrics.ranked) warnings.push('strong relationships exceed ranked candidates')
  if (warnings.length) console.warn('[DASHBOARD_METRIC_VALIDATION]', { warnings })
}
