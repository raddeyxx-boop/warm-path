const test = require('node:test')
const assert = require('node:assert/strict')

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
  const prepare = async (workflowRunId, searchRequestId) => {
    starts.push({ workflow_run_id: workflowRunId, search_request_id: searchRequestId })
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
