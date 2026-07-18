import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

export function usePageMeta(lastRefreshed, refresh) {
  const context = useOutletContext()

  useEffect(() => {
    context?.setPageMeta?.({ lastRefreshed, refresh })
  }, [context, lastRefreshed, refresh])
}
