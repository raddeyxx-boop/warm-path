import { useEffect } from 'react'
import { subscribeWorkflowRuns } from '../services/supabaseData'

export function useWorkflowCompletionRefresh(refresh) {
  useEffect(() => {
    return subscribeWorkflowRuns((event) => {
      if (event.new?.status === 'completed') refresh()
    })
  }, [refresh])
}
