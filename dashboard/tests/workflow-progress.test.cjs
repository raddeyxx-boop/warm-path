const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const root = join(__dirname, '..', 'src')
const runs = readFileSync(join(root, 'pages', 'Runs.jsx'), 'utf8')

test('completed workflow progress is normalized to a consistent terminal view', async () => {
  const { getWorkflowProgressView } = await import(pathToFileURL(join(root, 'utils', 'workflowProgress.js')))
  assert.deepEqual(getWorkflowProgressView({
    status: 'completed',
    progress_percent: 92,
    current_message: 'Processing failed after extraction.',
  }), {
    percentage: 100,
    label: 'Analysis complete.',
    state: 'completed',
  })
  assert.match(runs, /getWorkflowProgressView\(run\)/)
  assert.doesNotMatch(runs, /run\.current_message \|\| 'Preparing\.\.\.'/)
})

test('failed and cancelled workflows preserve real progress without appearing complete', async () => {
  const { getWorkflowProgressView } = await import(pathToFileURL(join(root, 'utils', 'workflowProgress.js')))
  assert.deepEqual(getWorkflowProgressView({
    status: 'failed',
    progress_percent: 92,
    current_message: 'Search failed.',
    n8n_dispatch_error: 'Webhook timed out.',
  }), {
    percentage: 92,
    label: 'Webhook timed out.',
    state: 'failed',
  })
  assert.deepEqual(getWorkflowProgressView({ status: 'cancelled', progress_percent: 55 }), {
    percentage: 55,
    label: 'Cancelled',
    state: 'cancelled',
  })
  assert.deepEqual(getWorkflowProgressView({ status: 'timed_out', progress_percent: 68 }), {
    percentage: 68,
    label: 'Timed out',
    state: 'timed_out',
  })
})

test('remaining time is read from persisted workflow data instead of elapsed-time inference', () => {
  assert.match(runs, /run\.estimated_remaining_seconds/)
  assert.doesNotMatch(runs, /elapsedSeconds \//)
})
