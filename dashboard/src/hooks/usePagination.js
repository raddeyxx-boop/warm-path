import { useMemo, useState } from 'react'

export function usePagination(initialPageSize = 25) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const controls = useMemo(
    () => ({
      page,
      pageSize,
      setPage,
      setPageSize: (value) => {
        setPageSize(value)
        setPage(1)
      },
      resetPage: () => setPage(1),
    }),
    [page, pageSize],
  )

  return controls
}
