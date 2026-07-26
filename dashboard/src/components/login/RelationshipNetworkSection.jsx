import { useState } from 'react'
import { Network, Star, UserRound } from 'lucide-react'

// Presentation-only illustrative graph data. It is never sent to an API or persisted.
const demoNodes = [
  { id: 'you', label: 'YOU', type: 'anchor', x: 8, y: 57, signals: ['Direct connection'], strength: 100, warm: true },
  { id: 'p1', label: 'Product lead', x: 20, y: 35, signals: ['Same Company', 'Shared Skills'], strength: 76 },
  { id: 'p2', label: 'Alumni', x: 22, y: 72, signals: ['Same School', 'Same Location'], strength: 61 },
  { id: 'p3', label: 'Former colleague', x: 28, y: 56, signals: ['Experience Overlap'], strength: 88, warm: true },
  { id: 'p4', label: 'Engineering manager', x: 35, y: 29, signals: ['Same Department'], strength: 69 },
  { id: 'p5', label: 'Technology peer', x: 39, y: 76, signals: ['Shared Technologies'], strength: 67 },
  { id: 'path', label: 'PATH', type: 'path', x: 49, y: 20, signals: ['Strongest path analysis'], strength: 90 },
  { id: 'p6', label: 'Mutual contact', x: 47, y: 43, signals: ['Shared Skills'], strength: 72 },
  { id: 'p7', label: 'Department director', x: 51, y: 55, signals: ['Current Employee', '6 Years at Company'], strength: 94, warm: true },
  { id: 'p8', label: 'Past coworker', x: 58, y: 76, signals: ['Experience Overlap'], strength: 64 },
  { id: 'p9', label: 'School connection', x: 63, y: 34, signals: ['Education Overlap'], strength: 59 },
  { id: 'p10', label: 'Regional contact', x: 68, y: 68, signals: ['Same Location'], strength: 66 },
  { id: 'p11', label: 'Internal sponsor', x: 73, y: 52, signals: ['Current Employee', 'Same Company'], strength: 96, warm: true },
  { id: 'p12', label: 'Industry peer', x: 78, y: 30, signals: ['Shared Technologies'], strength: 63 },
  { id: 'p13', label: 'Team connection', x: 82, y: 71, signals: ['Same Department'], strength: 71 },
  { id: 'target', label: 'TARGET', type: 'target', x: 93, y: 55, signals: ['Target person'], strength: 100, warm: true },
]

const demoEdges = [
  ['you', 'p1'], ['you', 'p2'], ['you', 'p3'], ['p1', 'p4'], ['p1', 'p6'], ['p2', 'p3'], ['p2', 'p5'],
  ['p3', 'p4'], ['p3', 'p5'], ['p3', 'p6'], ['p4', 'path'], ['p4', 'p7'], ['p5', 'p7'], ['p5', 'p8'],
  ['path', 'p6'], ['path', 'p9'], ['p6', 'p7'], ['p6', 'p9'], ['p7', 'p8'], ['p7', 'p9'], ['p7', 'p10'],
  ['p8', 'p10'], ['p9', 'p11'], ['p9', 'p12'], ['p10', 'p11'], ['p10', 'p13'], ['p11', 'p12'],
  ['p11', 'p13'], ['p11', 'target'], ['p12', 'target'], ['p13', 'target'],
].map(([source, target], index) => ({ source, target, dashed: index % 5 === 0 }))

const warmPath = ['you', 'p3', 'p7', 'p11', 'target']
const nodeMap = Object.fromEntries(demoNodes.map((node) => [node.id, node]))

function edgePath(sourceId, targetId) {
  const source = nodeMap[sourceId]
  const target = nodeMap[targetId]
  const bend = Math.abs(target.x - source.x) * 0.06
  return `M ${source.x} ${source.y} Q ${(source.x + target.x) / 2} ${((source.y + target.y) / 2) - bend} ${target.x} ${target.y}`
}

function NetworkNode({ node, selected, onSelect }) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const Icon = node.type === 'path' ? Network : node.type ? null : UserRound
  return <button type="button" className={`rn-node rn-node--${node.type || 'person'} ${node.warm ? 'is-warm' : ''} ${selected ? 'is-selected' : ''} ${tooltipOpen ? 'is-tooltip-open' : ''}`}
    style={{ left: `${node.x}%`, top: `${node.y}%` }} onClick={() => onSelect(node.id)}
    onMouseEnter={() => setTooltipOpen(true)} onMouseLeave={() => setTooltipOpen(false)}
    onFocus={() => setTooltipOpen(true)} onBlur={() => setTooltipOpen(false)}
    aria-label={`${node.label}. ${node.signals.join(', ')}. Example relationship strength ${node.strength} percent.`}>
    {Icon ? <Icon aria-hidden="true" /> : <span>{node.label}</span>}
    {!node.type ? <i aria-hidden="true"><Star /></i> : null}
    <span className="rn-tooltip" role="tooltip"><strong>{node.label}</strong><small>{node.signals.join(' · ')}</small><em>Example strength {node.strength}%</em></span>
  </button>
}

export function RelationshipNetworkSection() {
  const [selected, setSelected] = useState('p7')
  const selectedNode = nodeMap[selected]

  return <section id="network" className="wp-slide rn-section reveal-on-scroll" data-presentation-section>
    <div className="rn-header">
      <p className="wp-kicker"><span />Relationship network</p>
      <p className="rn-brand">INDPRO</p>
      <h2>Every connection creates a potential <mark>warm path.</mark></h2>
      <p>Warm Path Finder analyzes your real network to discover the strongest path to your target through people, experience, companies, schools, skills, technologies, locations, and shared relationships.</p>
    </div>
    <div className="rn-status"><span>Network status</span><strong><i />Active</strong></div>

    <div className="rn-graph" role="group" aria-label="Relationship network showing a strongest warm path from you through three people to a target, with alternate and indirect connections.">
      <p className="sr-only">This illustration shows a potential warm path from you to a target through several people. A brighter route identifies the strongest example path; dimmer lines represent alternate relationships.</p>
      <svg className="rn-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="warm-line" x1="0" x2="1"><stop stopColor="#4bdcff"/><stop offset="1" stopColor="#45f0a6"/></linearGradient></defs>
        <ellipse className="rn-orbit" cx="50" cy="54" rx="43" ry="34"/><ellipse className="rn-orbit rn-orbit--two" cx="50" cy="54" rx="37" ry="27"/>
        {demoEdges.map((edge) => <path key={`${edge.source}-${edge.target}`} className={edge.dashed ? 'rn-edge is-dashed' : 'rn-edge'} d={edgePath(edge.source, edge.target)} />)}
        {warmPath.slice(0, -1).map((source, index) => <path key={source} className="rn-warm-edge" d={edgePath(source, warmPath[index + 1])} />)}
        <path className="rn-warm-pulse" pathLength="1" d={warmPath.slice(0, -1).map((source, index) => edgePath(source, warmPath[index + 1]).replace(/^M /, index ? 'L ' : 'M ')).join(' ')} />
      </svg>
      {demoNodes.map((node) => <NetworkNode key={node.id} node={node} selected={selected === node.id} onSelect={setSelected} />)}
      <div className="rn-callout rn-callout--direct"><strong>Direct connection</strong><span>Strongest type of relationship</span></div>
      <div className="rn-callout rn-callout--context"><strong>Shared context</strong><span>Company, school, location, skills, and experience create links</span></div>
      <div className="rn-callout rn-callout--target"><strong>Target person</strong><span>The person you want to reach through a meaningful connection</span></div>
    </div>

    <div className="rn-support">
      <aside className="rn-legend"><h3>Legend</h3><p><i className="rn-key rn-key--star"/>Relationship / Connection</p><p><i className="rn-key rn-key--warm"/>Warm Path — Stronger</p><p><i className="rn-key rn-key--dashed"/>Indirect Connection</p><p><i className="rn-key rn-key--person"/>Person / Connection</p><p><span className="rn-stars">★★★★<i>★</i></span>Relationship Strength</p></aside>
      <div className="rn-stats" aria-label="Illustrative presentation statistics"><p><strong>24</strong><span>People in Network<br/>Analyzed</span></p><p><strong>68</strong><span>Possible Connections<br/>Identified</span></p><p><strong>1</strong><span>Strongest Warm Path<br/>Discovered</span></p></div>
      <aside className="rn-info"><h3>What is a warm path?</h3><p>A warm path exists only when a meaningful relationship or shared context connects your network to the target.</p><p>The more relevant and verifiable the evidence, the stronger the potential introduction path.</p><div className="rn-strength"><span>Path strength <small>Illustrative</small></span><strong>90%</strong><i><b /></i></div></aside>
    </div>
    <div className="rn-selected" aria-live="polite"><strong>{selectedNode.label}</strong><span>{selectedNode.signals.join(' · ')}</span><em>Illustrative strength {selectedNode.strength}%</em></div>
  </section>
}
