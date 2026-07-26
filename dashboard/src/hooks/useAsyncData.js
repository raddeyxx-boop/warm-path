import { useCallback, useEffect, useRef, useState } from 'react'

export function useAsyncData(loader, dependencies = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const loaderRef = useRef(loader)
  const mountedRef = useRef(false)
  const inFlightRef = useRef(null)
  const hasDataRef = useRef(false)
  const dependencyKey = JSON.stringify(dependencies)

  useEffect(() => {
    loaderRef.current = loader
  }, [loader])

  const execute = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current

    if (!hasDataRef.current) setLoading(true)
    setError('')

    const request = Promise.resolve()
      .then(() => loaderRef.current())
      .then((result) => {
        if (!mountedRef.current) return { ok: false, cancelled: true }
        hasDataRef.current = true
        setData(result)
        setLastRefreshed(new Date())
        return { ok: true, data: result }
      })
      .catch((err) => {
        if (!mountedRef.current) return { ok: false, cancelled: true }
        console.error(err)
        setError(err.message || 'Something went wrong while loading data.')
        return { ok: false, error: err }
      })
      .finally(() => {
        if (inFlightRef.current === request) inFlightRef.current = null
        if (mountedRef.current) setLoading(false)
      })

    inFlightRef.current = request
    return request
  }, [dependencyKey])

  useEffect(() => {
    mountedRef.current = true
    void execute()
    return () => {
      mountedRef.current = false
    }
  }, [execute])

  return {
    data,
    error,
    loading,
    lastRefreshed,
    refresh: execute,
  }
}
