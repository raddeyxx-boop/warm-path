import { useState } from 'react'
import { BrainCircuit, CheckCircle2, Network, ShieldCheck, Star, TriangleAlert, UserRound } from 'lucide-react'

const nodes = [
  { id: 'you', label: 'YOU', role: 'Network origin', x: 12, y: 14, kind: 'anchor', warm: true },
  { id: 'sarah', label: 'Sarah Chen', role: 'Senior Engineer', x: 34, y: 29, kind: 'person', warm: true, details: 'Same Company · Shared Skills · 6 Years' },
  { id: 'marcus', label: 'Marcus Hill', role: 'Engineering Manager', x: 56, y: 48, kind: 'star', warm: true, details: 'Current Employee · 7 Years' },
  { id: 'priya', label: 'Priya Shah', role: 'Platform Engineer', x: 75, y: 67, kind: 'person', warm: true, details: 'Shared Technologies · Experience Overlap' },
  { id: 'target', label: 'TARGET', role: 'Target person', x: 90, y: 87, kind: 'target', warm: true },
  { id: 'colleague', label: 'Colleague', role: 'Known contact', x: 16, y: 48, kind: 'person', details: 'Experience Overlap' },
  { id: 'alumni', label: 'Alumni', role: 'High-value connector', x: 38, y: 64, kind: 'star', details: 'Same School' },
  { id: 'friend', label: 'Friend', role: 'Known contact', x: 58, y: 82, kind: 'person', details: 'Location Match' },
  { id: 'director', label: 'Director', role: 'High-value connector', x: 79, y: 35, kind: 'star', details: 'Same Company · Long Tenure' },
]

const edges = [
  ['you', 'sarah'], ['sarah', 'marcus'], ['marcus', 'priya'], ['priya', 'target'],
  ['you', 'colleague'], ['colleague', 'alumni'], ['alumni', 'friend'], ['friend', 'target'],
  ['sarah', 'alumni'], ['marcus', 'director'], ['director', 'target'], ['colleague', 'marcus'], ['priya', 'friend'],
]
const warmIds = ['you-sarah', 'sarah-marcus', 'marcus-priya', 'priya-target']
const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]))

function linePath(sourceId, targetId) {
  const source = nodeMap[sourceId]
  const target = nodeMap[targetId]
  return `M ${source.x} ${source.y} C ${source.x + 8} ${source.y}, ${target.x - 8} ${target.y}, ${target.x} ${target.y}`
}

function IntelligenceNode({ node, active, onSelect }) {
  const [open, setOpen] = useState(false)
  const Icon = node.kind === 'star' ? Star : node.kind === 'person' ? UserRound : null
  return <button type="button"
    className={`cri-node cri-node--${node.kind} ${node.warm ? 'is-warm' : ''} ${active ? 'is-active' : ''} ${open ? 'is-open' : ''}`}
    style={{ left: `${node.x}%`, top: `${node.y}%` }}
    onClick={() => onSelect(node.id)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
    aria-label={`${node.label}, ${node.role}${node.details ? `, ${node.details}` : ''}`}>
    {Icon ? <Icon aria-hidden="true" /> : <span>{node.label}</span>}
    <span className="cri-tooltip" role="tooltip"><strong>{node.label}</strong><small>{node.role}</small>{node.details ? <em>{node.details}</em> : null}</span>
  </button>
}

const featureCards = [
  ['Real Relationship', Network, 'Recommendations are built only from real professional, educational, geographic, or organizational relationships.'],
  ['Explainable Evidence', ShieldCheck, 'Every recommendation is backed by visible relationship evidence.'],
  ['AI Relationship Analysis', BrainCircuit, 'Multiple relationship signals are evaluated before suggesting the strongest path.'],
]

export function CoreRequirementSection() {
  const [selected, setSelected] = useState('sarah')
  const selectedNode = nodeMap[selected]

  return <section id="principle" className="wp-slide cri-section reveal-on-scroll" data-presentation-section>
    <div className="cri-grid-overlay" aria-hidden="true" />
    <div className="cri-coordinates" aria-hidden="true"><span>REL-INT / 03</span><span>34.0522° N</span><span>SYS 10.4</span></div>
    <div className="cri-layout">
      <div className="cri-copy">
        <p className="wp-kicker"><span />Core requirement</p>
        <h2>You must have<br />a connection<br />with the target.</h2>
        <p className="wp-lead">Warm Path Finder discovers and evaluates real relationship paths. It does not invent relationships. A meaningful connection must exist before relationship intelligence can identify the strongest route.</p>
        <div className="cri-cards">
          {featureCards.map(([title, Icon, text], index) => <article key={title} style={{ '--card-delay': `${index * 140}ms` }}>
            <i><Icon aria-hidden="true" /></i><div><small>0{index + 1} / INTELLIGENCE LAYER</small><h3>{title}</h3><p>{text}</p></div>
          </article>)}
        </div>
        <aside className="cri-warning"><TriangleAlert aria-hidden="true" /><p><strong>Warm Path Finder cannot invent relationships.</strong><span>A meaningful connection must already exist.</span></p></aside>
      </div>

      <div className="cri-command">
        <div className="cri-hud" aria-label="Illustrative relationship engine status">
          <p><span>Network status</span><strong><i />Active</strong></p>
          <p><span>Relationship engine</span><strong>Running</strong></p>
          <p><span>Confidence</span><strong>98%</strong></p>
          <p><span>Relationship signals</span><strong>10</strong></p>
        </div>
        <div className="cri-graph" role="group" aria-label="Relationship intelligence graph with one highlighted warm path and several alternate routes">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="cri-warm" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#54ddff"/><stop offset="1" stopColor="#46efa5"/></linearGradient></defs>
            <ellipse className="cri-orbit" cx="52" cy="51" rx="43" ry="34"/><ellipse className="cri-orbit cri-orbit--inner" cx="52" cy="51" rx="31" ry="43"/>
            {edges.map(([source, target], index) => {
              const warm = warmIds.includes(`${source}-${target}`)
              return <path key={`${source}-${target}`} className={warm ? 'cri-edge cri-edge--warm' : `cri-edge ${index % 3 === 0 ? 'is-dashed' : ''}`} d={linePath(source, target)} />
            })}
            <path className="cri-signal" pathLength="1" d={warmIds.map((edge, index) => {
              const [source, target] = edge.split('-')
              return linePath(source, target).replace(index ? /^M [\d.]+ [\d.]+/ : '', index ? '' : linePath(source, target).match(/^M [\d.]+ [\d.]+/)[0])
            }).join(' ')} />
          </svg>
          {nodes.map((node) => <IntelligenceNode key={node.id} node={node} active={selected === node.id} onSelect={setSelected} />)}
          <div className="cri-callout cri-callout--one">Same Company</div><div className="cri-callout cri-callout--two">Shared Skills</div>
          <div className="cri-callout cri-callout--three">Current Employee</div><div className="cri-callout cri-callout--four">Shared Technologies</div>
          <div className="cri-path-label">The warm path <span>Primary route identified</span></div>
        </div>
        <div className="cri-selected" aria-live="polite"><span>Active node</span><strong>{selectedNode.label}</strong><small>{selectedNode.details || selectedNode.role}</small></div>
        <div className="cri-evidence-panel">
          <header><span>Relationship evidence</span><small>Illustrative analysis</small></header>
          <div className="cri-evidence-list">{['Same Company', 'Shared Technologies', 'Current Employee', '7 Years at Company'].map((item) => <span key={item}><CheckCircle2 />{item}</span>)}</div>
          <div className="cri-meter"><span>Overall strength</span><strong>92%</strong><i><b /></i></div>
        </div>
      </div>
    </div>
  </section>
}
