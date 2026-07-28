import { requireSupabaseSession } from './authSession'
import { getPlaywrightServerEndpoint } from './playwrightServerUrl'
import { assertLocalExecutionAvailable } from '../config/appMode'

export async function stopWorkflow(workflowRunId) {
  assertLocalExecutionAvailable('stop_workflow', 'run_details')
  const session = await requireSupabaseSession()
  const endpoint = getPlaywrightServerEndpoint(
    `/api/workflows/${encodeURIComponent(workflowRunId)}/stop`,
  )
  const response = await fetch(endpoint.href, {
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
  assertLocalExecutionAvailable('delete_workflow', 'run_details')
  const session = await requireSupabaseSession()
  const endpoint = getPlaywrightServerEndpoint(
    `/api/workflows/${encodeURIComponent(workflowRunId)}`,
  )
  const response = await fetch(endpoint.href, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(result?.message || `Unable to delete workflow (${response.status}).`)
  }
  return result
}
