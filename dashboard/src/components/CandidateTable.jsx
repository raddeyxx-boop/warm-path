import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  encodeRouteKey,
  fallback,
  formatScore,
  isValidLinkedInUrl,
  recommendationValue,
  relationshipValue,
} from '../utils/format'
import { Badge, GradeBadge } from './Badge'

function recommendationTone(candidate) {
  const recommendation = String(recommendationValue(candidate) || '').toLowerCase()
  if (recommendation.includes('strong') || recommendation.includes('high')) return 'success'
  if (recommendation.includes('moderate')) return 'warning'
  if (recommendation.includes('weak')) return 'danger'
  return 'muted'
}

export function CandidateTable({ candidates }) {
  return (
    <div className="table-wrap candidate-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Candidate</th>
            <th>Company</th>
            <th>Position</th>
            <th>Role</th>
            <th>Seniority</th>
            <th>Decision power</th>
            <th>Relationship</th>
            <th>Recommendation</th>
            <th>Score</th>
            <th>Grade</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, index) => (
            <tr key={candidate.id || `${candidate.rank}-${candidate.linkedin_url}-${index}`}>
              <td>{fallback(candidate.rank, '-')}</td>
              <td>
                <Link className="table-link" to={`/candidates/${encodeRouteKey(candidate)}`}>
                  {fallback(candidate.name)}
                </Link>
              </td>
              <td>{fallback(candidate.current_company)}</td>
              <td>{fallback(candidate.position)}</td>
              <td>{fallback(candidate.role)}</td>
              <td>{fallback(candidate.seniority)}</td>
              <td>{fallback(candidate.decision_power)}</td>
              <td>
                <Badge tone="info">{relationshipValue(candidate)}</Badge>
              </td>
              <td>
                <Badge tone={recommendationTone(candidate)}>
                  {candidate.recommendation || candidate.ai_analysis?.overall_recommendation}
                </Badge>
              </td>
              <td>{formatScore(candidate.final_score)}</td>
              <td>
                <GradeBadge value={candidate.final_grade} />
              </td>
              <td>
                {isValidLinkedInUrl(candidate.linkedin_url) ? (
                  <a className="icon-button" href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" aria-label="Open LinkedIn profile">
                    <ExternalLink size={16} aria-hidden="true" />
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
