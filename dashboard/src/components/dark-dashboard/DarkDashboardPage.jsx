import { useMemo } from 'react'
import { ArrowRight, RefreshCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { buildWarmPathGraphView } from '../../utils/darkDashboardGraph'
import { DarkDashboardHero } from './DarkDashboardHero'
import {
  DiscoveryActivityPanel,
  LiveMetricGrid,
  RecentWorkflowRuns,
  RelationshipEvidencePanel,
  TopWarmPaths,
} from './DarkDashboardSections'

export function DarkDashboardPage({ data, error, loading, onRetry }) {
  const totals = data?.totals
  const topRows = data?.topRows || []
  const recentRuns = data?.recentRuns || []
  const graphView = useMemo(
    () => buildWarmPathGraphView(data, { loading }),
    [data, loading],
  )

  return (
    <div className="dark-dashboard-page" aria-busy={loading}>
      <DarkDashboardHero graph={graphView} />
      {error ? (
        <section className="dark-dashboard-error" role="alert">
          <div>
            <p className="dark-dashboard-kicker">DATA LINK INTERRUPTED</p>
            <h2>Dashboard intelligence could not be loaded</h2>
            <p>{error}</p>
          </div>
          <button type="button" className="button button-primary" onClick={onRetry}>
            <RefreshCcw size={16} aria-hidden="true" />
            Retry connection
          </button>
        </section>
      ) : null}

      <LiveMetricGrid totals={totals} loading={loading} error={error} metricErrors={data?.metricErrors} />

      <div className="dark-dashboard-dual-grid">
        <DiscoveryActivityPanel recentRuns={recentRuns} loading={loading} />
        <RelationshipEvidencePanel candidates={topRows} loading={loading} />
      </div>

      <TopWarmPaths candidates={topRows} loading={loading} />
      <RecentWorkflowRuns runs={recentRuns} loading={loading} />

      <section className="dark-dashboard-cta" aria-labelledby="new-path-title">
        <div>
          <p className="dark-dashboard-kicker">NEXT DISCOVERY</p>
          <h2 id="new-path-title">Ready to discover a new path?</h2>
          <p>Enter a target and begin a new relationship-intelligence workflow.</p>
        </div>
        <Link className="button button-primary" to="/find-target">
          Find a New Target
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </div>
  )
}
