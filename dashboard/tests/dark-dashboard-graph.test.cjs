const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const moduleUrl = pathToFileURL(path.join(
  __dirname,
  '..',
  'src',
  'utils',
  'darkDashboardGraph.js',
)).href

function candidate(workflowRunId, name, rank, score) {
  return {
    id: `${workflowRunId}-${rank}`,
    workflow_run_id: workflowRunId,
    name,
    rank,
    final_score: score,
    relationship_strength: rank === 1 ? 'Strong' : 'Moderate',
    position: rank === 1 ? 'Business Development Executive' : 'HR Manager',
    current_company: 'Indpro AB',
    relationship_evidence: rank === 1
      ? { same_company: true, current_employee: true, shared_technologies: ['React'] }
      : { same_school: true },
  }
}

test('completed graph uses real target and ranked connectors from the same workflow as branches', async () => {
  const { buildWarmPathGraphView } = await import(moduleUrl)
  const view = buildWarmPathGraphView({
    recentRuns: [{ id: 'run-new', status: 'completed', target_person: 'G Mukesh' }],
    candidateWorkflowRunId: 'run-new',
    topRows: [
      candidate('run-new', 'Gowri N S', 1, 83),
      candidate('run-new', 'Sureshkumar Ramasamy', 2, 76),
    ],
  })

  assert.equal(view.targetName, 'G Mukesh')
  assert.equal(view.state, 'completed')
  assert.equal(view.mode, 'branching')
  assert.deepEqual(view.connectors.map((item) => item.name), ['Gowri N S', 'Sureshkumar Ramasamy'])
  assert.equal(view.connectors[0].isPrimary, true)
  assert.deepEqual(
    view.connectors[0].evidence.map((item) => item.label),
    ['Same company', 'Current employee', 'Shared technologies'],
  )
})

test('graph never combines a newer running target with older completed candidates', async () => {
  const { buildWarmPathGraphView } = await import(moduleUrl)
  const view = buildWarmPathGraphView({
    recentRuns: [
      {
        id: 'run-running',
        status: 'running',
        target_person: 'New Target',
        current_step: 'building_candidates',
        progress_percent: 72,
      },
      { id: 'run-old', status: 'completed', target_person: 'Old Target' },
    ],
    candidateWorkflowRunId: 'run-old',
    topRows: [candidate('run-old', 'Old Connector', 1, 88)],
  })

  assert.equal(view.workflowRunId, 'run-running')
  assert.equal(view.targetName, 'New Target')
  assert.equal(view.state, 'running')
  assert.equal(view.progress, 72)
  assert.deepEqual(view.connectors, [])
})

test('completed graph rejects candidates whose workflow identifier does not match', async () => {
  const { buildWarmPathGraphView } = await import(moduleUrl)
  const view = buildWarmPathGraphView({
    recentRuns: [{ id: 'run-current', status: 'completed', target_person: 'Current Target' }],
    candidateWorkflowRunId: 'run-stale',
    topRows: [candidate('run-stale', 'Stale Connector', 1, 91)],
  })

  assert.equal(view.state, 'no_path')
  assert.equal(view.statusLabel, 'NO VERIFIED PATH')
  assert.deepEqual(view.connectors, [])
})

test('failed and empty states expose truthful status without connector names', async () => {
  const { buildWarmPathGraphView } = await import(moduleUrl)
  const failed = buildWarmPathGraphView({
    recentRuns: [{ id: 'run-failed', status: 'failed', target_person: 'Failed Target' }],
    candidateWorkflowRunId: 'run-old',
    topRows: [candidate('run-old', 'Unrelated Connector', 1, 90)],
  })
  const idle = buildWarmPathGraphView({ recentRuns: [], topRows: [] })

  assert.equal(failed.state, 'failed')
  assert.equal(failed.statusLabel, 'ANALYSIS INTERRUPTED')
  assert.deepEqual(failed.connectors, [])
  assert.equal(idle.state, 'idle')
  assert.equal(idle.statusLabel, 'AWAITING TARGET')
})
