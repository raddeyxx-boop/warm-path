import { requireSupabaseSession } from './authSession'

const DEFAULT_WORKFLOW_RUN_URL = 'http://localhost:3000/run'

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

  console.debug('[workflow] authenticated owner_user_id', ownerUserId)
  console.debug('[workflow] Authorization header attached:', Boolean(session.access_token))

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
