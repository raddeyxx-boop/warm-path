import { requireSupabaseSession } from './authSession'

const DEFAULT_WORKFLOW_RUN_URL = 'http://localhost:3000/run'

function getApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

function getWorkflowRunUrl() {
  return import.meta.env.VITE_WORKFLOW_RUN_API_URL || DEFAULT_WORKFLOW_RUN_URL
}

function parseWorkflowResponse(response, contentType) {
  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}

export async function startWarmPathWorkflow(existingPayload = {}) {
  const session = await requireSupabaseSession()
  const ownerUserId = session.user.id
  const workflowRunUrl = getWorkflowRunUrl()

  if (!workflowRunUrl) {
    throw new Error('Missing VITE_WORKFLOW_RUN_API_URL.')
  }

  const payload = {
    ...existingPayload,
    owner_user_id: ownerUserId,
  }

  const response = await fetch(workflowRunUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  })

  const contentType = response.headers.get('content-type') ?? ''
  const result = await parseWorkflowResponse(response, contentType)

  if (!response.ok) {
    const message =
      typeof result === 'string'
        ? result
        : result?.error ??
          result?.message ??
          `Workflow request failed with status ${response.status}.`

    throw new Error(message)
  }

  return result
}

export async function stopWorkflow(workflowRunId) {
  const session = await requireSupabaseSession()
  const response = await fetch(`${getApiBaseUrl()}/api/workflows/${encodeURIComponent(workflowRunId)}/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(result?.message || `Unable to stop workflow (${response.status}).`)
  }
  return result
}

export async function deleteWorkflow(workflowRunId) {
  const session = await requireSupabaseSession()
  const response = await fetch(`${getApiBaseUrl()}/api/workflows/${encodeURIComponent(workflowRunId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(result?.message || `Unable to delete workflow (${response.status}).`)
  }
  return result
}
