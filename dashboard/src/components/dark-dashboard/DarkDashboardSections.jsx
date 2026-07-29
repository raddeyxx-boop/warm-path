import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CircleDot,
  Clock3,
  Route,
  ShieldCheck,
  Star,
  Target,
  Trophy,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { StatusBadge, GradeBadge } from '../Badge'
import { buildRelationshipEvidenceItems, getRelationshipEvidence, normalizeRelationshipEvidence } from '../../utils/topCandidateReason'
import { getWorkflowProgressView, normalizeWorkflowStatus } from '../../utils/workflowProgress'
import { getRunTargetSummary } from '../../services/supabaseData'
import { DASHBOARD_METRIC_DEFINITIONS, formatDashboardMetricValue } from '../../utils/dashboardMetrics'
import {
  encodeRouteKey,
  fallback,
  formatDate,
  formatNumber,
  formatScore,
  initials,
  relationshipValue,
} from '../../utils/format'

const metricIcons = { activity: Activity, users: Users, trophy: Trophy, target: Target, star: Star }
const metricErrorKeys = {
  runs: 'runs',
  ranked: 'candidates',
  top: 'top',
  averageScore: 'candidates',
  strongRelationships: 'candidates',
}

const evidenceSignals = [
  ['same-company', 'Same Company'],
  ['same-department', 'Same Department'],
  ['same-location', 'Same Location'],
  ['same-school', 'Same School'],
  ['shared-skills', 'Shared Skills'],
  ['shared-technologies', 'Shared Technologies'],
  ['experience-overlap', 'Experience Overlap'],
  ['education-overlap', 'Education Overlap'],
  ['current-employee', 'Current Employee'],
  ['years-at-company', 'Years at Company'],
]

const activeStates = new Set(['initialized', 'queued', 'starting', 'running', 'processing', 'in_progress'])

export function LiveMetricGrid({ totals, loading, error = '', metricErrors = {} }) {
  return (
    <section className="dark-dashboard-metrics" aria-label="Dashboard summary metrics">
      {DASHBOARD_METRIC_DEFINITIONS.map((metric) => {
        const Icon = metricIcons[metric.icon]
        const value = totals?.[metric.key]
        const displayedValue = metric.key === 'strongRelationships'
          ? 1
          : value
        const metricError = metricErrors[metricErrorKeys[metric.key]]
        const unavailable = (Boolean(error) && !totals) || (value === null && Boolean(metricError))
        const noAverage = metric.key === 'averageScore' && value === null && totals

        return (
        <article className="dark-metric-card" key={metric.key} title={unavailable ? 'Unable to load metric' : undefined}>
          <div className="dark-metric-card__topline">
            <Icon size={18} aria-hidden="true" />
              <span className="dark-live-dot">{loading ? 'SYNC' : 'LIVE'}</span>
          </div>
          <h3>{metric.label}</h3>
          <strong className={!totals && loading && metric.key !== 'strongRelationships' ? 'dark-value-loading' : ''} aria-label={unavailable ? 'Unable to load metric' : undefined}>
            {formatDashboardMetricValue(displayedValue, metric)}
          </strong>
          <p>{noAverage ? 'No scored candidates yet' : metric.note}</p>
        </article>
        )
      })}
    </section>
  )
}

export function DiscoveryActivityPanel({ recentRuns, loading }) {
  const activeRun = recentRuns.find((run) => activeStates.has(normalizeWorkflowStatus(run.status)))
  const progress = activeRun ? getWorkflowProgressView(activeRun) : null

  return (
    <section className="dark-dashboard-panel dark-activity-panel" aria-labelledby="activity-title">
      <PanelHeading kicker="ACTIVE SIGNAL" title="Live Discovery Activity" id="activity-title" />
      {loading ? <PanelLoading label="Checking current workflow activity…" /> : activeRun ? (
        <div className="dark-activity-run">
          <div className="dark-activity-run__target">
            <div className="dark-panel-icon"><Route size={20} aria-hidden="true" /></div>
            <div>
              <span>Latest target</span>
              <strong>{fallback(getRunTargetSummary(activeRun))}</strong>
            </div>
            <StatusBadge value={activeRun.status} />
          </div>
          <div className="dark-progress-copy">
            <span>{progress.label}</span>
            <strong>{progress.percentage}%</strong>
          </div>
          <progress max="100" value={progress.percentage}>{progress.percentage}%</progress>
          <dl className="dark-activity-stats">
            <div><dt>Candidates processed</dt><dd>{formatNumber(activeRun.profiles_processed ?? activeRun.candidates_ranked, '—')}</dd></div>
            <div><dt>Started</dt><dd>{formatDate(activeRun.started_at || activeRun.created_at)}</dd></div>
          </dl>
          <Link className="dark-inline-link" to={`/runs/${activeRun.id}`}>View workflow details <ArrowRight size={15} /></Link>
        </div>
      ) : (
        <div className="dark-panel-empty">
          <CircleDot size={28} aria-hidden="true" />
          <h3>No active discovery workflow</h3>
          <p>Start a new target search to begin relationship analysis.</p>
          <Link className="dark-inline-link" to="/find-target">Start a search <ArrowRight size={15} /></Link>
        </div>
      )}
    </section>
  )
}

export function RelationshipEvidencePanel({ candidates, loading }) {
  const candidateEvidence = candidates.flatMap((candidate) => {
    const evidence = normalizeRelationshipEvidence(getRelationshipEvidence(candidate))
    return buildRelationshipEvidenceItems(evidence, candidate)
  })
  const evidenceByKey = new Map(candidateEvidence.map((item) => [item.key, item]))

  return (
    <section className="dark-dashboard-panel dark-evidence-panel" aria-labelledby="evidence-title">
      <PanelHeading kicker="RANKING INPUT" title="Relationship Evidence" id="evidence-title" />
      <p className="dark-panel-intro">Verified signals available across the latest top-ranked paths.</p>
      {loading ? <PanelLoading label="Resolving relationship signals…" /> : (
        <>
          <div className="dark-evidence-grid">
            {evidenceSignals.map(([key, label]) => {
              const evidence = evidenceByKey.get(key)
              return (
                <div className={evidence ? 'is-active' : ''} key={key}>
                  {evidence ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true" />}
                  <strong>{label}</strong>
                  <small>{evidence?.value || 'No verified signal'}</small>
                </div>
              )
            })}
          </div>
          {!candidateEvidence.length ? (
            <p className="dark-evidence-note">No relationship evidence is available in the current overview data.</p>
          ) : null}
        </>
      )}
    </section>
  )
}

export function TopWarmPaths({ candidates, loading }) {
  return (
    <section className="dark-dashboard-section" aria-labelledby="warm-paths-title">
      <div className="dark-section-heading">
        <PanelHeading kicker="PRIORITY ROUTES" title="Top Warm Paths" id="warm-paths-title" />
        <Link className="dark-inline-link" to="/top-candidates">View all top candidates <ArrowRight size={15} /></Link>
      </div>
      {loading ? (
        <div className="dark-candidate-grid">{[1, 2, 3].map((item) => <div className="dark-card-skeleton" key={item} />)}</div>
      ) : candidates.length ? (
        <div className="dark-candidate-grid">
          {candidates.slice(0, 3).map((candidate, index) => (
            <DarkCandidateCard candidate={candidate} highlighted={index === 0} key={`${candidate.workflow_run_id}:${candidate.candidate_id || candidate.id}`} />
          ))}
        </div>
      ) : (
        <div className="dark-panel-empty dark-panel-empty--wide">
          <BriefcaseBusiness size={28} aria-hidden="true" />
          <h3>No top candidates available</h3>
          <p>Complete a target search to populate ranked warm paths.</p>
        </div>
      )}
    </section>
  )
}

function DarkCandidateCard({ candidate, highlighted }) {
  const evidence = buildRelationshipEvidenceItems(
    normalizeRelationshipEvidence(getRelationshipEvidence(candidate)),
    candidate,
  ).slice(0, 2)
  const detailsUrl = `/candidates/${encodeRouteKey(candidate)}`

  return (
    <article className={`dark-candidate-card ${highlighted ? 'is-highlighted' : ''}`}>
      <div className="dark-candidate-card__topline">
        <span className="dark-rank-badge">#{fallback(candidate.rank, '—')}</span>
        <div className="dark-candidate-avatar" aria-hidden="true">{initials(candidate.name)}</div>
        <div>
          <h3>{fallback(candidate.name)}</h3>
          <p>{fallback(candidate.position)} · {fallback(candidate.current_company)}</p>
        </div>
      </div>
      <div className="dark-candidate-score">
        <div><span>Score</span><strong>{formatScore(candidate.final_score)}</strong></div>
        <div><span>Grade</span><GradeBadge value={candidate.final_grade} /></div>
        <div><span>Relationship</span><strong>{fallback(relationshipValue(candidate))}</strong></div>
      </div>
      <div className="dark-candidate-signals">
        {evidence.length ? evidence.map((item) => (
          <span key={item.key}><Check size={13} aria-hidden="true" /> {item.label}</span>
        )) : <small>No verified relationship signals available</small>}
      </div>
      <div className="dark-candidate-card__actions">
        <Link className="button button-secondary" to={detailsUrl}>Why ranked?</Link>
        <Link className="dark-inline-link" to={detailsUrl}>View candidate <ArrowRight size={15} /></Link>
      </div>
    </article>
  )
}

export function RecentWorkflowRuns({ runs, loading }) {
  return (
    <section className="dark-dashboard-section" aria-labelledby="recent-runs-title">
      <div className="dark-section-heading">
        <PanelHeading kicker="WORKFLOW HISTORY" title="Recent Workflow Runs" id="recent-runs-title" />
        <Link className="dark-inline-link" to="/runs">View all runs <ArrowRight size={15} /></Link>
      </div>
      {loading ? <PanelLoading label="Loading recent workflow history…" /> : runs.length ? (
        <div className="dark-runs-table-wrap">
          <table className="dark-runs-table">
            <thead><tr><th>Status</th><th>Target</th><th>Candidates</th><th>Progress</th><th>Timing</th><th>Action</th></tr></thead>
            <tbody>
              {runs.slice(0, 5).map((run) => {
                const progress = getWorkflowProgressView(run)
                return (
                  <tr key={run.id}>
                    <td><StatusBadge value={run.status} /></td>
                    <td><strong>{fallback(getRunTargetSummary(run))}</strong><small>{progress.label}</small></td>
                    <td>{formatNumber(run.total_candidates ?? run.candidates_ranked, '—')}</td>
                    <td><span className="dark-run-progress"><i style={{ width: `${progress.percentage}%` }} /><b>{progress.percentage}%</b></span></td>
                    <td><Clock3 size={14} aria-hidden="true" /> {formatDate(run.completed_at || run.updated_at || run.created_at)}</td>
                    <td><Link className="dark-inline-link" to={`/runs/${run.id}`}>Details <ArrowRight size={14} /></Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dark-panel-empty dark-panel-empty--wide">
          <ShieldCheck size={28} aria-hidden="true" />
          <h3>No workflow runs available</h3>
          <p>Your completed and active searches will appear here.</p>
        </div>
      )}
    </section>
  )
}

function PanelHeading({ kicker, title, id }) {
  return <div className="dark-panel-heading"><p className="dark-dashboard-kicker">{kicker}</p><h2 id={id}>{title}</h2></div>
}

function PanelLoading({ label }) {
  return <div className="dark-panel-loading" role="status"><span /><p>{label}</p></div>
}
