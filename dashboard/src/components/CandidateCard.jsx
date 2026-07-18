import { Check, Copy, ExternalLink, HelpCircle, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  encodeRouteKey,
  fallback,
  formatScore,
  getNestedValue,
  initials,
  introductionValue,
  isValidLinkedInUrl,
  relationshipValue,
  truncate,
} from '../utils/format'
import {
  buildRelationshipEvidenceItems,
  getReasonHeading,
  getRelationshipEvidence,
  getTopCandidateReason,
  normalizeRelationshipEvidence,
} from '../utils/topCandidateReason'
import { Badge, GradeBadge } from './Badge'

export const HOVER_FLIP_DELAY = 800
export const FLIP_DURATION = 480

export function CandidateCard({ candidate, prominent = false, enableReasonFlip = false }) {
  const [copied, setCopied] = useState(false)
  const [isFlipped, setIsFlipped] = useState(false)
  const [flipSource, setFlipSource] = useState(null)
  const [supportsHover, setSupportsHover] = useState(false)
  const hoverTimerRef = useRef(null)
  const actionHoverRef = useRef(false)
  const whyRankedButtonRef = useRef(null)
  const backButtonRef = useRef(null)
  const cardRef = useRef(null)

  const intro = introductionValue(candidate)
  const hiring = getNestedValue(candidate, ['hiring_influence', 'analysis.hiring_influence'])
  const relationship = relationshipValue(candidate)
  const detailsUrl = `/candidates/${encodeRouteKey(candidate)}`
  const reason = getTopCandidateReason(candidate)
  const reasonHeading = getReasonHeading(candidate)
  const relationshipEvidence = normalizeRelationshipEvidence(getRelationshipEvidence(candidate))
  const relationshipEvidenceItems = buildRelationshipEvidenceItems(relationshipEvidence, candidate)
  const candidateName = fallback(candidate.name, 'this candidate')

  function clearHoverTimer() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  function scheduleHoverFlip() {
    if (!enableReasonFlip || !supportsHover || isFlipped || actionHoverRef.current) return
    clearHoverTimer()
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      if (actionHoverRef.current) return
      setFlipSource('hover')
      setIsFlipped(true)
    }, HOVER_FLIP_DELAY)
  }

  useEffect(() => {
    if (!enableReasonFlip || typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    const syncHoverSupport = () => setSupportsHover(query.matches)
    syncHoverSupport()
    query.addEventListener?.('change', syncHoverSupport)
    return () => query.removeEventListener?.('change', syncHoverSupport)
  }, [enableReasonFlip])

  useEffect(() => clearHoverTimer, [])

  useEffect(() => {
    if (isFlipped && flipSource === 'explicit') {
      window.setTimeout(() => backButtonRef.current?.focus(), 0)
    }
  }, [flipSource, isFlipped])

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

  function showReason() {
    clearHoverTimer()
    setFlipSource('explicit')
    setIsFlipped(true)
  }

  function showFront({ restoreFocus = true } = {}) {
    clearHoverTimer()
    setIsFlipped(false)
    setFlipSource(null)
    if (restoreFocus) {
      window.setTimeout(() => whyRankedButtonRef.current?.focus(), 0)
    }
  }

  function pauseHoverFlip() {
    actionHoverRef.current = true
    clearHoverTimer()
  }

  function resumeHoverFlip(event) {
    actionHoverRef.current = false
    if (!cardRef.current?.contains(event.relatedTarget)) return
    scheduleHoverFlip()
  }

  function handlePointerEnter(event) {
    if (event.target?.closest?.('.card-actions')) return
    scheduleHoverFlip()
  }

  function handlePointerLeave() {
    clearHoverTimer()
    if (flipSource === 'hover') {
      setIsFlipped(false)
      setFlipSource(null)
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && isFlipped) {
      event.preventDefault()
      showFront({ restoreFocus: cardRef.current?.contains(document.activeElement) })
    }
  }

  function renderFront(tabIndex) {
    return (
      <>
        <div className="candidate-topline">
          <span className="rank-badge">#{fallback(candidate.rank, '-')}</span>
          <div className="avatar" aria-hidden="true">
            {initials(candidate.name)}
          </div>
          <div>
            <Link to={detailsUrl} className="candidate-name" title={fallback(candidate.name)} tabIndex={tabIndex}>
              {fallback(candidate.name)}
            </Link>
            <p title={`${fallback(candidate.position)} at ${fallback(candidate.current_company)}`}>
              {fallback(candidate.position)} at {fallback(candidate.current_company)}
            </p>
          </div>
        </div>

        <div className="candidate-metrics">
          <div>
            <span>Score</span>
            <strong>{formatScore(candidate.final_score)}</strong>
          </div>
          <div>
            <span>Grade</span>
            <GradeBadge value={candidate.final_grade} />
          </div>
          <div>
            <span>Relationship</span>
            <Badge tone="info">{relationship}</Badge>
          </div>
        </div>

        <dl className="compact-list">
          <div>
            <dt>Location</dt>
            <dd>{fallback(candidate.location)}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{fallback(candidate.role)}</dd>
          </div>
          <div>
            <dt>Seniority</dt>
            <dd>{fallback(candidate.seniority)}</dd>
          </div>
          <div>
            <dt>Decision power</dt>
            <dd>{fallback(candidate.decision_power)}</dd>
          </div>
          <div>
            <dt>Hiring influence</dt>
            <dd>{fallback(hiring)}</dd>
          </div>
          <div>
            <dt>Recommendation</dt>
            <dd>{fallback(candidate.recommendation || candidate.ai_analysis?.overall_recommendation)}</dd>
          </div>
        </dl>

        {intro ? <p className="intro-preview">{truncate(intro, prominent ? 260 : 160)}</p> : null}

        <div
          className="card-actions"
          onPointerEnter={enableReasonFlip ? pauseHoverFlip : undefined}
          onPointerLeave={enableReasonFlip ? resumeHoverFlip : undefined}
          onFocus={enableReasonFlip ? pauseHoverFlip : undefined}
          onBlur={enableReasonFlip ? resumeHoverFlip : undefined}
        >
          {isValidLinkedInUrl(candidate.linkedin_url) ? (
            <a className="button button-secondary" href={candidate.linkedin_url} target="_blank" rel="noreferrer noopener" tabIndex={tabIndex}>
              <ExternalLink size={16} aria-hidden="true" />
              LinkedIn
            </a>
          ) : null}
          {intro ? (
            <button type="button" className="button button-secondary" onClick={copyIntro} tabIndex={tabIndex}>
              <Copy size={16} aria-hidden="true" />
              {copied ? 'Copied' : 'Copy intro'}
            </button>
          ) : null}
          {enableReasonFlip ? (
            <button
              ref={whyRankedButtonRef}
              type="button"
              className="button button-secondary button-reason"
              onClick={showReason}
              tabIndex={tabIndex}
              aria-label={`Show ranking reason for ${candidateName}`}
              aria-expanded={isFlipped}
            >
              <HelpCircle size={16} aria-hidden="true" />
              Why ranked?
            </button>
          ) : null}
        </div>
      </>
    )
  }

  if (!enableReasonFlip) {
    return (
      <article className={`card candidate-card ${prominent ? 'candidate-card-prominent' : ''}`}>
        {renderFront(undefined)}
      </article>
    )
  }

  return (
    <article
      ref={cardRef}
      className={`candidate-flip-card ${prominent ? 'candidate-flip-card-prominent' : ''}`}
      data-flipped={isFlipped}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
      style={{ '--flip-duration': `${FLIP_DURATION}ms` }}
    >
      <div className="candidate-flip-card__inner">
        <section
          className="card candidate-card candidate-card-front"
          aria-hidden={isFlipped}
        >
          {renderFront(isFlipped ? -1 : undefined)}
        </section>
        <section
          className="card candidate-card candidate-card-back"
          aria-hidden={!isFlipped}
        >
          <div className="reason-card">
            <p className="eyebrow">Why ranked</p>
            <h3>{reasonHeading}</h3>
            {reason.summary ? <p className="reason-summary">{reason.summary}</p> : null}
            {reason.highlights?.length ? (
              <div className="reason-highlights">
                <p>Key reasons</p>
                <ul>
                  {reason.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {relationshipEvidenceItems.length ? (
              <section className="relationship-evidence" aria-label="Relationship evidence">
                <p className="reason-section-label">Relationship evidence</p>
                <ul>
                  {relationshipEvidenceItems.map((item) => (
                    <li key={item.key}>
                      <span className="evidence-check" aria-hidden="true">
                        <Check size={13} />
                      </span>
                      <span className="evidence-copy">
                        <strong>{item.label}</strong>
                        {item.value ? <small>{item.value}</small> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="reason-context" aria-label="Score and grade context">
              {candidate.final_score !== null && candidate.final_score !== undefined ? (
                <span>Score {formatScore(candidate.final_score)}</span>
              ) : null}
              {fallback(candidate.final_grade, '') !== 'Not available' ? <span>Grade {fallback(candidate.final_grade)}</span> : null}
            </div>
            <button
              ref={backButtonRef}
              type="button"
              className="button button-secondary"
              onClick={() => showFront()}
              tabIndex={isFlipped ? undefined : -1}
              aria-label={`Return to profile details for ${candidateName}`}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Back to profile
            </button>
          </div>
        </section>
      </div>
    </article>
  )
}
