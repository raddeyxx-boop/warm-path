const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'dashboardMetrics.js')).href

function ranked(id, finalScore, relationshipScore = null, workflowRunId = 'run-current') {
  return {
    id,
    workflow_run_id: workflowRunId,
    final_score: finalScore,
    relationship_strength_score: relationshipScore,
  }
}

test('canonical dashboard metrics reproduce the shared five-card values', async () => {
  const { calculateDashboardMetrics } = await import(moduleUrl)
  const candidates = Array.from({ length: 30 }, (_, index) =>
    ranked(`candidate-${index}`, index < 18 ? 66 : null),
  )

  assert.deepEqual(calculateDashboardMetrics({
    workflowRunId: 'run-current',
    workflowRuns: 1,
    rankedCandidates: candidates,
    topCandidates: candidates.slice(0, 3),
  }), {
    runs: 1,
    ranked: 30,
    top: 3,
    averageScore: 66,
    strongRelationships: 0,
  })
})

test('empty successful data preserves real zeros and a null average', async () => {
  const { calculateDashboardMetrics } = await import(moduleUrl)
  assert.deepEqual(calculateDashboardMetrics({
    workflowRunId: 'run-current',
    workflowRuns: 0,
    rankedCandidates: [],
    topCandidates: [],
  }), {
    runs: 0,
    ranked: 0,
    top: 0,
    averageScore: null,
    strongRelationships: 0,
  })
})

test('average excludes invalid values, supports numeric strings, and deduplicates stable IDs', async () => {
  const { calculateDashboardMetrics } = await import(moduleUrl)
  const candidates = [
    ranked('one', '83'),
    ranked('one', '10'),
    ranked('two', 49),
    ranked('three', null),
    ranked('four', undefined),
    ranked('five', Number.NaN),
    ranked('six', Number.POSITIVE_INFINITY),
    ranked('seven', ''),
    ranked('eight', 'score 90'),
    ranked('nine', 101),
  ]
  const metrics = calculateDashboardMetrics({
    workflowRunId: 'run-current',
    workflowRuns: 1,
    rankedCandidates: candidates,
    topCandidates: [candidates[0]],
  })

  assert.equal(metrics.ranked, 9)
  assert.equal(metrics.averageScore, 66)
})

test('strong relationships retain the existing relationship-score threshold', async () => {
  const { calculateDashboardMetrics } = await import(moduleUrl)
  const metrics = calculateDashboardMetrics({
    workflowRunId: 'run-current',
    workflowRuns: 1,
    rankedCandidates: [
      ranked('strong', 70, 80),
      ranked('very-strong', 70, 95),
      ranked('medium', 70, 79),
      { ...ranked('label-only', 70), relationship_strength: 'Strong' },
    ],
    topCandidates: [],
  })

  assert.equal(metrics.strongRelationships, 2)
})

test('candidate metrics include only the canonical workflow run', async () => {
  const { calculateDashboardMetrics } = await import(moduleUrl)
  const current = ranked('current', 80, 90, 'run-current')
  const stale = ranked('stale', 20, 90, 'run-old')

  assert.deepEqual(calculateDashboardMetrics({
    workflowRunId: 'run-current',
    workflowRuns: 2,
    rankedCandidates: [current, stale],
    topCandidates: [current, stale],
  }), {
    runs: 2,
    ranked: 1,
    top: 1,
    averageScore: 80,
    strongRelationships: 1,
  })
})

test('unavailable query inputs remain null and format as placeholders', async () => {
  const { calculateDashboardMetrics, formatDashboardMetricValue } = await import(moduleUrl)
  assert.deepEqual(calculateDashboardMetrics(), {
    runs: null,
    ranked: null,
    top: null,
    averageScore: null,
    strongRelationships: null,
  })
  assert.equal(formatDashboardMetricValue(null), '—')
  assert.equal(formatDashboardMetricValue(0), '0')
})
