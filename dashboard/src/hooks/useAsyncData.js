import { useCallback, useEffect, useRef, useState } from 'react'

export function useAsyncData(loader, dependencies = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const loaderRef = useRef(loader)
  const dependencyKey = JSON.stringify(dependencies)

  useEffect(() => {
    loaderRef.current = loader
  }, [loader])

  const refresh = useCallback(() => {
    setRefreshIndex((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError('')

      try {
        const result = await loaderRef.current()
        if (!active) return
        setData(result)
        setLastRefreshed(new Date())
      } catch (err) {
        if (!active) return
        console.error(err)
        setError(err.message || 'Something went wrong while loading data.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [dependencyKey, refreshIndex])

  return {
    data,
    error,
    loading,
    lastRefreshed,
    refresh,
  }
}
