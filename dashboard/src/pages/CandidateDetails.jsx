import { Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, GradeBadge } from '../components/Badge'
import { JsonSection } from '../components/JsonTree'
import { EmptyState, ErrorState, LoadingState } from '../components/StateBlocks'
import { useAsyncData } from '../hooks/useAsyncData'
import { usePageMeta } from '../hooks/usePageMeta'
import { getCandidateIntroduction, getCandidateRelationship, getRankedCandidateById } from '../services/supabaseData'
import { fallback, formatDate, formatScore, initials, isValidLinkedInUrl } from '../utils/format'

export function CandidateDetails() {
  const { id: candidateId } = useParams()
  const [copied, setCopied] = useState(false)

  const { data, error, loading, lastRefreshed, refresh } = useAsyncData(() => getRankedCandidateById(candidateId), [candidateId])
  usePageMeta(lastRefreshed, refresh)

  if (loading) return <LoadingState label="Loading candidate details..." />
  if (error) return <ErrorState message={error} onRetry={refresh} />
  if (!data) return <EmptyState title="Candidate not found" message="The selected candidate could not be found." />

  const intro = getCandidateIntroduction(data)
  const relationship = getCandidateRelationship(data)

  async function copyIntro() {
    if (!intro) return
    try {
      await navigator.clipboard.writeText(String(intro))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (error) {
      console.error('Could not copy introduction', error)
    }
  }

  return (
    <div className="page-stack">
      <section className="card hero-card">
        <div className="candidate-topline">
          <div className="avatar avatar-large" aria-hidden="true">{initials(data.name)}</div>
          <div>
            <p className="eyebrow">Rank #{fallback(data.rank, '-')}</p>
            <h2>{fallback(data.name)}</h2>
            <p>{fallback(data.position)} at {fallback(data.current_company)}</p>
            <p className="muted">{fallback(data.location)}</p>
          </div>
        </div>
        <div className="hero-actions">
          <Link className="button button-secondary" to="/candidates">
            Back to candidates
          </Link>
          {isValidLinkedInUrl(data.linkedin_url) ? (
            <a className="button button-primary" href={data.linkedin_url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={16} aria-hidden="true" />
              LinkedIn profile
            </a>
          ) : null}
          {intro ? (
            <button type="button" className="button button-secondary" onClick={copyIntro}>
              <Copy size={16} aria-hidden="true" />
              {copied ? 'Copied' : 'Copy intro'}
            </button>
          ) : null}
        </div>
      </section>

      <section className="grid detail-grid">
        <Metric label="Final score" value={formatScore(data.final_score)} />
        <Metric label="Final grade" value={<GradeBadge value={data.final_grade} />} />
        <Metric label="Recommendation" value={data.recommendation || data.ai_analysis?.overall_recommendation} />
        <Metric label="Relationship" value={<Badge tone="info">{relationship}</Badge>} />
        <Metric label="Role" value={data.role} />
        <Metric label="Seniority" value={data.seniority} />
        <Metric label="Decision power" value={data.decision_power} />
        <Metric label="Created" value={formatDate(data.created_at)} />
      </section>

      <div className="details-layout details-layout-single">
        <div className="details-column">
          {intro ? (
            <section className="card detail-section">
              <p className="eyebrow">Personalized introduction</p>
              <h2>Warm opening</h2>
              <p className="intro-full">{intro}</p>
            </section>
          ) : null}

          <JsonSection title="Raw candidate row" value={data} />
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <article className="card metric-card">
      <span>{label}</span>
      <strong>{typeof value === 'string' || typeof value === 'number' ? fallback(value) : value}</strong>
    </article>
  )
}
