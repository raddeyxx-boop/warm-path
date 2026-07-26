import {
  Check, CirclePlay, Filter, LayoutDashboard, ListFilter, Radar, Search, Target, Users, Workflow,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const commandCenterDemoSteps = [
  { id: 'overview', title: 'Overview', caption: 'Monitor search activity, workflow progress, and high-level results.', durationMs: 5000, icon: LayoutDashboard },
  { id: 'top', title: 'Top Candidates', caption: 'Review the highest-priority warm paths and understand why they ranked.', durationMs: 6000, icon: Radar },
  { id: 'candidates', title: 'All Candidates', caption: 'Search, filter, and compare the full candidate pool.', durationMs: 6000, icon: Users },
  { id: 'runs', title: 'Workflow Runs', caption: 'Follow each automated search from launch to final report.', durationMs: 6000, icon: Workflow },
  { id: 'target', title: 'Find a New Target', caption: 'Enter accurate target details and start a new relationship discovery.', durationMs: 6000, icon: Target },
]

const demoCandidates = [
  ['01', 'MR', 'Maya Rao', 'Partnerships Director', '94', 'A+', 'Strong', 'Same company · Long tenure'],
  ['02', 'DC', 'Daniel Chen', 'Enterprise Architect', '89', 'A', 'Strong', 'Shared technology · Same location'],
  ['03', 'SM', 'Sara Malik', 'Product Strategy Lead', '84', 'A-', 'Moderate', 'Same school · Experience overlap'],
]

function OverviewDemo() {
  return <div className="cc-page cc-overview">
    <DemoHeading eyebrow="Relationship intelligence" title="Overview" text="High-level workspace intelligence at a glance." />
    <div className="cc-stat-grid">
      {[['Active searches', '2'], ['Candidates analyzed', '28'], ['Strong paths found', '3']].map(([label, value]) =>
        <article key={label}><span>{label}</span><strong>{value}</strong><i /></article>)}
    </div>
    <div className="cc-overview-lower">
      <div className="cc-chart"><span>SEARCH ACTIVITY</span>{[28, 46, 34, 62, 52, 76, 68, 91].map((height, index) => <i key={index} style={{ '--bar': `${height}%` }} />)}</div>
      <div className="cc-network"><span>RELATIONSHIP SIGNAL</span><b>YOU</b><i /><i /><i /><strong>TARGET</strong></div>
    </div>
  </div>
}

function TopCandidatesDemo() {
  return <div className="cc-page">
    <DemoHeading eyebrow="Highest priority" title="Top Candidates" text="The strongest ranked paths, ready for review." />
    <div className="cc-candidate-grid">{demoCandidates.map(([rank, initials, name, role, score, grade, strength, reason], index) =>
      <article className={index === 0 ? 'is-leading' : ''} key={name}>
        <b>{rank}</b><div className="cc-avatar">{initials}</div><h4>{name}</h4><p>{role}</p>
        <div><span>Score <strong>{score}</strong></span><span>Grade <strong>{grade}</strong></span><span>{strength}</span></div>
        <small><Check /> {reason}</small>{index === 0 ? <em>WHY RANKED? · 4 verified signals</em> : null}
      </article>)}</div>
  </div>
}

function AllCandidatesDemo() {
  return <div className="cc-page">
    <DemoHeading eyebrow="Candidate intelligence" title="All Candidates" text="Filter the ranked pool without losing context." />
    <div className="cc-filters"><span><Search /> Maya</span><span><ListFilter /> Score: highest</span><span><Filter /> Grade: A</span><span>Role: Leadership</span></div>
    <div className="cc-table">
      <div className="cc-table-head"><span>Candidate</span><span>Role</span><span>Grade</span><span>Strength</span><span>Score</span></div>
      {demoCandidates.map(([, initials, name, role, score, grade, strength]) =>
        <div key={name}><span><i>{initials}</i>{name}</span><span>{role}</span><span>{grade}</span><span>{strength}</span><strong>{score}</strong></div>)}
    </div>
    <small className="cc-filter-note">DEMO FILTER ACTIVE · 3 VALID MATCHES</small>
  </div>
}

function WorkflowRunsDemo() {
  return <div className="cc-page">
    <DemoHeading eyebrow="Workflow history" title="Workflow Runs" text="Every automated search remains visible from launch to report." />
    <div className="cc-run-list">
      <article><span className="cc-status is-running">RUNNING</span><h4>Jordan Blake</h4><p>Analyzing relationship evidence...</p><div className="cc-progress"><i style={{ width: '76%' }} /></div><footer><span>76%</span><span>19 / 25 candidates</span><span>8 min elapsed</span><button type="button" tabIndex="-1">View details</button></footer></article>
      <article><span className="cc-status is-complete">COMPLETED</span><h4>Alex Morgan</h4><p>Analysis complete.</p><div className="cc-progress"><i style={{ width: '100%' }} /></div><footer><span>100%</span><span>28 candidates</span><span>12 min</span><button type="button" tabIndex="-1">View results</button></footer></article>
    </div>
  </div>
}

function NewTargetDemo() {
  const fields = [['Target Name', 'Alex Morgan'], ['Current Company', 'Northstar Technologies'], ['LinkedIn URL', 'linkedin.com/in/alex-morgan'], ['Location', 'Riyadh, Saudi Arabia']]
  return <div className="cc-page">
    <DemoHeading eyebrow="New relationship search" title="Find a New Target" text="Accurate target context starts every warm-path search." />
    <div className="cc-target-form">
      {fields.map(([label, value], index) => <label className={index === 2 ? 'is-focused' : ''} key={label}><span>{label}</span><output>{value}</output></label>)}
      <div className="cc-optional"><span>Keywords · Enterprise systems</span><span>Company filter · Optional</span></div>
      <p><Check /> Confirm that a meaningful relationship path may already exist.</p>
      <button type="button" tabIndex="-1"><CirclePlay /> Start Search</button>
    </div>
  </div>
}

function DemoHeading({ eyebrow, title, text }) {
  return <header className="cc-page-heading"><span>{eyebrow}</span><h3>{title}</h3><p>{text}</p></header>
}

const pageComponents = [OverviewDemo, TopCandidatesDemo, AllCandidatesDemo, WorkflowRunsDemo, NewTargetDemo]

export default function CommandCenterDemo() {
  const rootRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const [tabVisible, setTabVisible] = useState(!document.hidden)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [playing, setPlaying] = useState(false)
  const [manualPause, setManualPause] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { threshold: 0.28 })
    observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = (event) => {
      setReducedMotion(event.matches)
      if (event.matches) {
        setActiveIndex(0)
        setPlaying(false)
        setManualPause(false)
      }
    }
    const onVisibilityChange = () => setTabVisible(!document.hidden)
    query.addEventListener('change', onMotionChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      query.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (isVisible && tabVisible && !reducedMotion && !manualPause) setPlaying(true)
    if (!isVisible || !tabVisible) setPlaying(false)
  }, [isVisible, manualPause, tabVisible, reducedMotion])

  useEffect(() => {
    if (!manualPause || !isVisible || !tabVisible || reducedMotion) return undefined
    const timer = window.setTimeout(() => setManualPause(false), 8000)
    return () => window.clearTimeout(timer)
  }, [isVisible, manualPause, reducedMotion, tabVisible])

  useEffect(() => {
    if (!playing || !isVisible || !tabVisible || reducedMotion) return undefined
    const timer = window.setTimeout(() => setActiveIndex((index) => (index + 1) % commandCenterDemoSteps.length), commandCenterDemoSteps[activeIndex].durationMs)
    return () => window.clearTimeout(timer)
  }, [activeIndex, isVisible, playing, reducedMotion, tabVisible])

  const selectStep = (index) => {
    setActiveIndex(index)
    setPlaying(false)
    if (!reducedMotion) setManualPause(true)
  }
  const ActivePage = pageComponents[activeIndex]
  const activeStep = commandCenterDemoSteps[activeIndex]

  return <div className="cc-demo" ref={rootRef} aria-label="Warm Path Finder command center walkthrough">
    <p className="sr-only">This demonstration cycles through Overview, Top Candidates, All Candidates, Workflow Runs, and Find a New Target to show how the Warm Path Finder workspace supports the complete discovery process.</p>
    <div className="cc-frame">
      <div className="cc-frame-top"><span><i /> SYSTEM WALKTHROUGH</span><strong>LIVE DEMO · FICTIONAL DATA</strong></div>
      <div className="cc-screen">
        <aside className="cc-sidebar" aria-label="Demo pages">
          <b>WPF</b>
          {commandCenterDemoSteps.map((step, index) => {
            const Icon = step.icon
            return <button type="button" className={index === activeIndex ? 'is-active' : ''} onClick={() => selectStep(index)} aria-current={index === activeIndex ? 'page' : undefined} key={step.id}><Icon /><span>{step.title}</span></button>
          })}
        </aside>
        <div className="cc-viewport" key={activeStep.id}><ActivePage /></div>
        <div className="cc-scan" aria-hidden="true" />
      </div>
      <div className="cc-caption"><span>0{activeIndex + 1} / 05 · {activeStep.title}</span><p>{activeStep.caption}</p></div>
    </div>
  </div>
}
