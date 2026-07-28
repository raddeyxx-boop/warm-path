const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const FIRST_WORKFLOW_ID = '11111111-1111-4111-8111-111111111111'
const FIRST_SEARCH_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_WORKFLOW_ID = '66666666-6666-4666-8666-666666666666'
const SECOND_SEARCH_ID = '77777777-7777-4777-8777-777777777777'

async function modules() {
  const submission = await import('../src/services/targetSearchSubmission.js')
  const contract = await import('../../types/target-search-request.ts')
  return { ...submission, ...contract }
}

test('consecutive submissions use only their own current values and returned IDs', async () => {
  const { normalizeLinkedInProfileUrl, submitTargetSearchOnce } = await modules()
  const lock = { current: false }
  const initializedForms = []
  const starts = []
  const ids = [
    [FIRST_WORKFLOW_ID, FIRST_SEARCH_ID],
    [SECOND_WORKFLOW_ID, SECOND_SEARCH_ID],
  ]
  let call = 0

  const initialize = async (form) => {
    const normalizedForm = {
      ...form,
      linkedinName: normalizeLinkedInProfileUrl(form.linkedinName),
    }
    initializedForms.push(normalizedForm)
    const [workflowRunId, searchRequestId] = ids[call++]
    return { ok: true, workflowRunId, searchRequestId, normalizedForm }
  }
  const prepare = async (workflowRunId, searchRequestId, initialization) => {
    starts.push({
      workflow_run_id: workflowRunId,
      search_request_id: searchRequestId,
      target_name: initialization.normalizedForm.targetName,
    })
    return { status: 'running' }
  }

  await submitTargetSearchOnce({
    lock,
    form: {
      targetName: 'Gurupreet Singh', currentCompany: 'Indpro AB',
      linkedinName: 'https://www.linkedin.com/in/gurupreet-singh-2344aa2bb/',
      location: 'Greater Bengaluru Area', keywords: '', companyFilter: '', schoolFilter: '',
    },
    initialize,
    prepare,
  })
  await submitTargetSearchOnce({
    lock,
    form: {
      targetName: 'Ali Elsheik', currentCompany: 'Anfal',
      linkedinName: 'linkedin.com/in/Ali-elsheik', location: 'KSA',
      keywords: '', companyFilter: '', schoolFilter: '',
    },
    initialize,
    prepare,
  })

  assert.deepEqual(starts[1], {
    workflow_run_id: SECOND_WORKFLOW_ID,
    search_request_id: SECOND_SEARCH_ID,
    target_name: 'Ali Elsheik',
  })
  assert.deepEqual(initializedForms[1], {
    targetName: 'Ali Elsheik', currentCompany: 'Anfal',
    linkedinName: 'https://www.linkedin.com/in/Ali-elsheik', location: 'KSA',
    keywords: '', companyFilter: '', schoolFilter: '',
  })
  assert.equal(JSON.stringify({ form: initializedForms[1], start: starts[1] }).includes('Gurupreet'), false)
  assert.equal(JSON.stringify({ form: initializedForms[1], start: starts[1] }).includes(FIRST_WORKFLOW_ID), false)
  assert.equal(JSON.stringify({ form: initializedForms[1], start: starts[1] }).includes(FIRST_SEARCH_ID), false)
})

test('a rapid second submission is ignored while initialization is in progress', async () => {
  const { submitTargetSearchOnce } = await modules()
  const lock = { current: false }
  let initializationCount = 0
  let releaseInitialization
  const waiting = new Promise((resolve) => { releaseInitialization = resolve })
  const initialize = async (form) => {
    initializationCount += 1
    await waiting
    return {
      ok: true,
      workflowRunId: SECOND_WORKFLOW_ID,
      searchRequestId: SECOND_SEARCH_ID,
      normalizedForm: form,
    }
  }

  const first = submitTargetSearchOnce({ lock, form: { targetName: 'Ali' }, initialize, prepare: async () => ({}) })
  const second = await submitTargetSearchOnce({ lock, form: { targetName: 'Ali' }, initialize, prepare: async () => ({}) })
  assert.deepEqual(second, { ignored: true })
  assert.equal(initializationCount, 1)
  releaseInitialization()
  await first
  assert.equal(lock.current, false)
})

test('target search dispatch goes directly to the configured Playwright server', () => {
  const serviceSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'targetSearchService.js'),
    'utf8',
  )
  assert.match(serviceSource, /\/api\/searches\/start/)
  assert.doesNotMatch(serviceSource, /supabase\.rpc\('start_target_search'/)
  assert.match(serviceSource, /Authorization: `Bearer \$\{session\.access_token\}`/)
  assert.doesNotMatch(serviceSource, /VITE_PLAYWRIGHT_WORKER_SECRET/)
})

test('server URL normalization is local-only and has no fallback', async () => {
  const {
    buildPlaywrightServerEndpoint,
    normalizePlaywrightServerBaseUrl,
  } = await import(
    '../src/services/playwrightServerUrl.js'
  )
  assert.equal(
    normalizePlaywrightServerBaseUrl(
      ' http://localhost:3000/// ',
      { appMode: 'local' },
    ).url.href,
    'http://localhost:3000/',
  )
  assert.throws(
    () => normalizePlaywrightServerBaseUrl('', { appMode: 'local' }),
    (error) => error.code === 'PLAYWRIGHT_SERVER_NOT_CONFIGURED',
  )
  assert.throws(
    () => normalizePlaywrightServerBaseUrl(
      'http://localhost:3000',
      { appMode: 'demo' },
    ),
    (error) => error.code === 'PLAYWRIGHT_SERVER_NOT_CONFIGURED',
  )
  assert.equal(
    normalizePlaywrightServerBaseUrl(
      'http://localhost:3000/',
      { appMode: 'local' },
    ).url.href,
    'http://localhost:3000/',
  )
  assert.equal(
    buildPlaywrightServerEndpoint(
      'http://localhost:3000/',
      '/api/searches/start',
      { appMode: 'local' },
    ).url.href,
    'http://localhost:3000/api/searches/start',
  )
})

test('demo mode guards precede initialization and workflow mutations', () => {
  const findSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'FindTarget.jsx'), 'utf8')
  const workflowSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'workflowService.js'), 'utf8')
  assert.ok(findSource.indexOf('if (demoMode)') < findSource.indexOf('await submitTargetSearchOnce'))
  for (const action of ['stop_workflow', 'delete_workflow']) {
    assert.match(workflowSource, new RegExp(`assertLocalExecutionAvailable\\('${action}'`))
  }
  assert.ok(
    workflowSource.indexOf("assertLocalExecutionAvailable('stop_workflow'") <
      workflowSource.indexOf('requireSupabaseSession()'),
  )
})

test('workflow actions use the server helper and contain no generic backend fallback', () => {
  const workflowSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'workflowService.js'),
    'utf8',
  )
  assert.match(workflowSource, /getPlaywrightServerEndpoint/)
  assert.doesNotMatch(workflowSource, /VITE_API_BASE_URL/)
  assert.doesNotMatch(workflowSource, /VITE_WORKFLOW_RUN_API_URL/)
  assert.doesNotMatch(workflowSource, /localhost:3000/)
  assert.doesNotMatch(workflowSource, /\/run['"`]/)
})
