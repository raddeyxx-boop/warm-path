import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CandidateCard } from '../components/CandidateCard'
import { CandidateTable } from '../components/CandidateTable'
import { Pagination } from '../components/Pagination'
import { EmptyState, ErrorState, LoadingState } from '../components/StateBlocks'
import { useAsyncData } from '../hooks/useAsyncData'
import { usePagination } from '../hooks/usePagination'
import { usePageMeta } from '../hooks/usePageMeta'
import { useWorkflowCompletionRefresh } from '../hooks/useWorkflowCompletionRefresh'
import { getRankedCandidates, getCandidateRelationship } from '../services/supabaseData'

const filterFields = [
  ['final_grade', 'Final grade'],
  ['role', 'Role'],
  ['seniority', 'Seniority'],
  ['decision_power', 'Decision power'],
  ['recommendation', 'Recommendation'],
  ['relationship_strength', 'Relationship strength'],
  ['current_company', 'Current company'],
]

const sortOptions = [
  ['rank', 'Rank ascending'],
  ['score-high', 'Score highest'],
  ['score-low', 'Score lowest'],
  ['name', 'Name A-Z'],
  ['company', 'Company A-Z'],
  ['newest', 'Newest'],
]

export function Candidates() {
  const pagination = usePagination(25)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState('rank')

  const loader = () =>
    getRankedCandidates({
      page: pagination.page,
      pageSize: pagination.pageSize,
      search,
      filters,
      sort,
    })

  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(loader, [
    pagination.page,
    pagination.pageSize,
    search,
    JSON.stringify(filters),
    sort,
  ])
  usePageMeta(lastRefreshed, refresh)
  useWorkflowCompletionRefresh(refresh)

  const options = useMemo(() => {
    const rows = data?.data || []
    const result = {}
    for (const [field] of filterFields) {
      result[field] = [
        ...new Set(
          rows
            .map((row) => (field === 'relationship_strength' ? getCandidateRelationship(row) : row[field]))
            .filter(Boolean)
            .map(String),
        ),
      ].sort()
    }
    return result
  }, [data])

  const activeFilterCount = Object.values(filters).filter(Boolean).length + (search ? 1 : 0)

  function updateFilter(field, value) {
    pagination.resetPage()
    setFilters((current) => ({ ...current, [field]: value }))
  }

  function clearFilters() {
    pagination.resetPage()
    setSearch('')
    setFilters({})
    setSort('rank')
  }

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Candidate intelligence</p>
          <h2>All Candidates</h2>
          <p>Filter the ranked candidate pool without losing the current Supabase-backed workflow.</p>
        </div>
        {activeFilterCount ? (
          <button type="button" className="button button-secondary" onClick={clearFilters}>
            Clear filters ({activeFilterCount})
          </button>
        ) : null}
      </div>

      <div className="toolbar card">
        <label className="search-field">
          <span>Search candidates</span>
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => {
              pagination.resetPage()
              setSearch(event.target.value)
            }}
            placeholder="Search name, company, role..."
          />
        </label>
        <label>
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {sortOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {filterFields.map(([field, label]) => (
          <label key={field}>
            {label}
            <select value={filters[field] || ''} onChange={(event) => updateFilter(field, event.target.value)}>
              <option value="">All</option>
              {(options[field] || []).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {loading ? <LoadingState label="Loading ranked candidates..." /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!loading && !error && data?.data?.length ? (
        <>
          <CandidateTable candidates={data.data} />
          <div className="mobile-cards">
            {data.data.map((candidate, index) => (
              <CandidateCard candidate={candidate} key={candidate.id || `${candidate.rank}-${index}`} />
            ))}
          </div>
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={data.count || 0}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </>
      ) : null}
      {!loading && !error && !data?.data?.length ? (
        <EmptyState title="No candidates found" message="No rows match the selected search and filters." />
      ) : null}
    </section>
  )
}
