import { useEffect } from 'react'
import { subscribeWorkflowRuns } from '../services/supabaseData'

export function useWorkflowCompletionRefresh(refresh, { refreshEveryChange = false } = {}) {
  useEffect(() => {
    return subscribeWorkflowRuns((event) => {
      if (refreshEveryChange || event.new?.status === 'completed') refresh()
    })
  }, [refresh, refreshEveryChange])
}
