export function normalizeSubmissionForm(form) {
  return Object.fromEntries(
    Object.entries(form).map(([key, value]) => [key, String(value ?? '').trim()]),
  )
}

export async function submitTargetSearchOnce({
  lock,
  form,
  pendingInitialization = null,
  initialize,
  prepare,
  onInitialized,
  onPreparing,
}) {
  if (lock.current) return { ignored: true }
  lock.current = true

  try {
    const normalizedForm = normalizeSubmissionForm(form)
    const initialization = pendingInitialization || await initialize(normalizedForm)

    if (!initialization.ok) {
      return { ignored: false, normalizedForm, initialization, preparation: null }
    }

    onInitialized?.(initialization)
    onPreparing?.(initialization)
    const preparation = await prepare(
      initialization.workflowRunId,
      initialization.searchRequestId,
    )

    return { ignored: false, normalizedForm, initialization, preparation }
  } finally {
    lock.current = false
  }
}
