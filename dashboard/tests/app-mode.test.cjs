const test = require('node:test')
const assert = require('node:assert/strict')

async function appMode() {
  return import('../src/config/appMode.js')
}

test('explicit local and demo modes resolve deterministically', async () => {
  const { resolveAppMode } = await appMode()
  assert.equal(resolveAppMode('local'), 'local')
  assert.equal(resolveAppMode('demo'), 'demo')
})

test('missing mode defaults to local in development and demo in production', async () => {
  const { resolveAppMode } = await appMode()
  assert.equal(resolveAppMode('', { dev: true }), 'local')
  assert.equal(resolveAppMode('', { dev: false }), 'demo')
})

test('unsupported mode is rejected and demo execution is blocked', async () => {
  const { assertLocalExecutionAvailable, resolveAppMode } = await appMode()
  assert.throws(() => resolveAppMode('hosted'), (error) => error.code === 'APP_MODE_INVALID')
  assert.throws(
    () => assertLocalExecutionAvailable('start_search', 'test', 'demo'),
    (error) => error.code === 'DEMO_MODE_EXECUTION_BLOCKED',
  )
})
