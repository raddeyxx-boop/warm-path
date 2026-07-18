import { CandidateCard } from '../components/CandidateCard'
import { EmptyState, ErrorState, LoadingState } from '../components/StateBlocks'
import { useAsyncData } from '../hooks/useAsyncData'
import { usePageMeta } from '../hooks/usePageMeta'
import { useWorkflowCompletionRefresh } from '../hooks/useWorkflowCompletionRefresh'
import { getTopCandidates } from '../services/supabaseData'

export function TopCandidates() {
  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(() => getTopCandidates({ limit: 100 }), [])
  usePageMeta(lastRefreshed, refresh)
  useWorkflowCompletionRefresh(refresh)

  if (loading) return <LoadingState label="Loading top candidates..." />
  if (error) return <ErrorState message={error} onRetry={refresh} />

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Highest priority</p>
          <h2>Top Candidates ({data?.length || 0})</h2>
          <p>The strongest ranked candidates from the current top-candidate view.</p>
        </div>
      </div>
      {data?.length ? (
        <div className="grid cards-grid">
          {data.map((candidate, index) => (
            <CandidateCard candidate={candidate} prominent enableReasonFlip key={candidate.id || `${candidate.rank}-${index}`} />
          ))}
        </div>
      ) : (
        <EmptyState title="No top candidates available" message="No rows are readable from top_candidates." />
      )}
    </section>
  )
}
