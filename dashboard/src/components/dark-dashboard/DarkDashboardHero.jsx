import { useEffect, useRef, useState } from 'react'
import { Activity, Search, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'

export function DarkDashboardHero({ graph }) {
  const primary = graph.connectors[0] || null

  return (
    <section className={`dark-dashboard-hero graph-state-${graph.state}`} aria-labelledby="dark-dashboard-title">
      <div className="dark-dashboard-hero__copy">
        <p className="dark-dashboard-kicker">RELATIONSHIP INTELLIGENCE COMMAND CENTER</p>
        <h2 id="dark-dashboard-title">
          Turn your network into the <span>strongest warm path.</span>
        </h2>
        <p>
          Discover, rank, and understand the people who can create the most meaningful route to your target.
        </p>
        <dl className="dark-hero-live-context" aria-label="Latest relationship analysis">
          <div>
            <dt>Latest target</dt>
            <dd>{graph.targetName || (graph.state === 'loading' ? 'Resolving targetâ€¦' : 'No target analyzed')}</dd>
          </div>
          <div>
            <dt>Strongest connector</dt>
            <dd>{primary?.name || (graph.state === 'running' ? 'Analysis in progress' : 'No verified connector')}</dd>
          </div>
          <div>
            <dt>Relationship strength</dt>
            <dd>{primary?.relationshipStrength || 'Not available'}</dd>
          </div>
        </dl>
        <div className="dark-dashboard-hero__actions">
          <Link className="button button-primary" to="/find-target">
            <Search size={17} aria-hidden="true" />
            Find a New Target
          </Link>
          <Link className="button button-secondary" to="/top-candidates">
            <Trophy size={17} aria-hidden="true" />
            View Top Candidates
          </Link>
        </div>
      </div>
      <RelationshipNetworkVisual graph={graph} />
    </section>
  )
}

function RelationshipNetworkVisual({ graph }) {
  const [activeNodeId, setActiveNodeId] = useState(null)
  const closeTimerRef = useRef(null)
  const graphRef = useRef(null)
  const pointerTypeRef = useRef('')
  const [primary, alternate] = graph.connectors
  const targetLabel = graph.targetName ||
    (graph.state === 'loading' ? 'Resolving targetâ€¦' : 'No target')

  const cancelClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }
  const openNode = (nodeId) => {
    cancelClose()
    setActiveNodeId(nodeId)
  }
  const closeNode = () => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setActiveNodeId(null), 130)
  }
  const handleNodeClick = (event, nodeId) => {
    if (pointerTypeRef.current !== 'touch') return
    event.preventDefault()
    cancelClose()
    setActiveNodeId((current) => current === nodeId ? null : nodeId)
  }
  const interactionProps = (nodeId) => ({
    onPointerEnter: (event) => {
      if (event.pointerType !== 'touch') openNode(nodeId)
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== 'touch') closeNode()
    },
    onPointerDown: (event) => {
      pointerTypeRef.current = event.pointerType
    },
    onFocus: () => openNode(nodeId),
    onBlur: closeNode,
    onKeyDown: () => {
      pointerTypeRef.current = 'keyboard'
    },
    onClick: (event) => handleNodeClick(event, nodeId),
  })

  useEffect(() => {
    setActiveNodeId(null)
  }, [graph.workflowRunId])

  useEffect(() => {
    const closeFromOutside = (event) => {
      if (!graphRef.current?.contains(event.target)) setActiveNodeId(null)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  return (
    <div ref={graphRef} className={`relationship-network-visual graph-mode-${graph.mode} graph-state-${graph.state}`}>
      <p className="sr-only">{graph.accessibleSummary}</p>
      <div className="dark-graph-status" role="status">
        <Activity size={13} aria-hidden="true" />
        <span>{graph.statusLabel}</span>
        {graph.progress !== null && graph.state === 'running' ? <strong>{graph.progress}%</strong> : null}
      </div>
      {graph.stageLabel ? <p className="dark-graph-stage">{graph.stageLabel}</p> : null}

      <svg viewBox="0 0 620 380" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="dark-dashboard-earth" cx="50%" cy="45%">
            <stop offset="0%" stopColor="#0c4660" stopOpacity=".92" />
            <stop offset="72%" stopColor="#042233" stopOpacity=".82" />
            <stop offset="100%" stopColor="#03121f" stopOpacity=".2" />
          </radialGradient>
          <filter id="dark-dashboard-glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle className="network-orbit orbit-one" cx="350" cy="190" r="148" />
        <ellipse className="network-orbit orbit-two" cx="350" cy="190" rx="226" ry="112" />
        <circle className="network-earth" cx="350" cy="190" r="116" fill="url(#dark-dashboard-earth)" />
        <path className="network-earth-line" d="M260 152c62 24 132 19 184-13M252 220c69-18 142-11 194 19M332 77c-31 72-31 155 3 226M383 82c27 72 26 144-4 215" />
        <path className="network-link network-link-muted" d="M84 290 212 248 318 282 506 284" />
        <path className="network-link network-link-muted" d="M138 93 244 139 354 103 508 116" />

        {graph.mode === 'branching' ? (
          <>
            <path className="network-link network-link-active network-route-primary" d="M90 190 C172 104 270 104 330 126 S470 128 541 190" />
            <path className="network-link network-route-alternate" d="M90 190 C172 278 270 278 330 254 S470 252 541 190" />
            <circle className="network-travel-pulse" cx="0" cy="0" r="6" filter="url(#dark-dashboard-glow)">
              <animateMotion dur="4.8s" repeatCount="indefinite" path="M90 190 C172 104 270 104 330 126 S470 128 541 190" />
            </circle>
          </>
        ) : null}
        {graph.mode === 'single' ? (
          <>
            <path className="network-link network-link-active network-route-primary" d="M90 190 C210 112 405 112 541 190" />
            <circle className="network-travel-pulse" cx="0" cy="0" r="6" filter="url(#dark-dashboard-glow)">
              <animateMotion dur="4.8s" repeatCount="indefinite" path="M90 190 C210 112 405 112 541 190" />
            </circle>
          </>
        ) : null}
        {graph.mode === 'none' ? (
          <path className={`network-link network-route-unverified ${graph.state === 'running' ? 'is-analyzing' : ''}`} d="M90 190 C220 126 405 126 541 190" />
        ) : null}

        <g className="network-node network-node-you" transform="translate(90 190)">
          <circle r="28" /><circle r="19" />
        </g>
        <g className="network-node network-node-target" transform="translate(541 190)">
          <circle r="31" /><circle r="21" />
        </g>
        <circle className="network-person-dot" cx="138" cy="93" r="8" />
        <circle className="network-person-dot" cx="244" cy="139" r="7" />
        <circle className="network-person-dot" cx="354" cy="103" r="8" />
        <circle className="network-person-dot" cx="508" cy="116" r="7" />
        <circle className="network-person-dot" cx="84" cy="290" r="7" />
        <circle className="network-person-dot" cx="212" cy="248" r="8" />
        <circle className="network-person-dot" cx="318" cy="282" r="7" />
        <circle className="network-person-dot" cx="506" cy="284" r="8" />
      </svg>

      <span className="dark-graph-node dark-graph-node--you"><strong>YOU</strong></span>
      {primary ? <ConnectorNode connector={primary} position={graph.mode === 'branching' ? 'primary' : 'single'} active={activeNodeId === `connector-${primary.candidateId}`} interactionProps={interactionProps(`connector-${primary.candidateId}`)} /> : null}
      {alternate ? <ConnectorNode connector={alternate} position="alternate" active={activeNodeId === `connector-${alternate.candidateId}`} interactionProps={interactionProps(`connector-${alternate.candidateId}`)} /> : null}
      {graph.state === 'running' ? (
        <span className="dark-graph-analyzing">Analyzing connectorâ€¦</span>
      ) : graph.state === 'no_path' ? (
        <span className="dark-graph-no-path">No verified warm path yet</span>
      ) : null}
      <GraphTargetNode graph={graph} label={targetLabel} active={activeNodeId === 'target'} interactionProps={interactionProps('target')} />
    </div>
  )
}

function ConnectorNode({ connector, position, active, interactionProps }) {
  return (
    <Link
      className={`dark-graph-node dark-graph-node--connector dark-graph-node--${position} ${connector.isPrimary ? 'is-primary' : ''} ${active ? 'is-active' : ''}`}
      to={connector.detailsUrl}
      title={connector.name}
      aria-label={`${connector.name}, rank ${connector.rank}. View candidate details.`}
      aria-expanded={active}
      {...interactionProps}
    >
      <span className="dark-graph-node__core" aria-hidden="true" />
      <strong>{connector.name}</strong>
      <small>{connector.isPrimary ? 'STRONGEST CONNECTOR' : 'ALTERNATE CONNECTOR'}</small>
      <span className="dark-graph-evidence">
        {connector.evidence.length
          ? connector.evidence.slice(0, 2).map((item) => <i key={item.key}>{item.label}</i>)
          : <i>Evidence unavailable</i>}
      </span>
      {active ? <span className="dark-graph-tooltip" role="tooltip">
        <b>{connector.name}</b>
        <span>{[connector.position, connector.company].filter(Boolean).join(' at ') || 'Professional details unavailable'}</span>
        <span>Rank #{connector.rank}{connector.score === null ? '' : ` Â· Score ${Math.round(connector.score)}`}</span>
        {connector.relationshipStrength ? <span>{connector.relationshipStrength} relationship</span> : null}
        {connector.evidence.length ? <span>{connector.evidence.map((item) => item.text).join(' Â· ')}</span> : null}
      </span> : null}
    </Link>
  )
}

function GraphTargetNode({ graph, label, active, interactionProps }) {
  const content = (
    <>
      <span className="dark-graph-node__core" aria-hidden="true" />
      <strong title={graph.targetName || undefined}>{label}</strong>
      <small>TARGET</small>
      {active ? <span className="dark-graph-tooltip dark-graph-tooltip--target" role="tooltip">
        <b>{label}</b>
        <span>{graph.statusLabel}</span>
      </span> : null}
    </>
  )

  return graph.runDetailsUrl ? (
    <Link
      className={`dark-graph-node dark-graph-node--target ${active ? 'is-active' : ''}`}
      to={graph.runDetailsUrl}
      aria-label={`${label}, target. View workflow details.`}
      aria-expanded={active}
      {...interactionProps}
    >
      {content}
    </Link>
  ) : (
    <span
      className={`dark-graph-node dark-graph-node--target ${active ? 'is-active' : ''}`}
      tabIndex="0"
      aria-label={`${label}, target.`}
      aria-expanded={active}
      {...interactionProps}
    >
      {content}
    </span>
  )
}
