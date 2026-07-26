import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Activity, ArrowDown, BriefcaseBusiness, Building2, CheckCircle2,
  CircleDot, Cpu, Database, GraduationCap, LayoutDashboard, Link2, MapPin,
  Network, Radar, Search, ShieldCheck, Sparkles, Target, Users,
} from 'lucide-react'
import { RelationshipNetworkSection } from './RelationshipNetworkSection'
import { CoreRequirementSection } from './CoreRequirementSection'

const CommandCenterDemo = lazy(() => import('./CommandCenterDemo'))

const evidence = [
  ['Same Company', Building2, 'Current or previous organizational overlap.'],
  ['Same Department', BriefcaseBusiness, 'A shared function or business area.'],
  ['Same Location', MapPin, 'A shared city, region, or professional location.'],
  ['Same School', GraduationCap, 'A shared educational institution.'],
  ['Shared Skills', Sparkles, 'Overlapping professional capabilities.'],
  ['Shared Technologies', Cpu, 'Common tools, platforms, or technical domains.'],
  ['Experience Overlap', Activity, 'Related companies, roles, industries, or periods.'],
  ['Education Overlap', GraduationCap, 'Related programs, fields, or study periods.'],
  ['Current Employee', CheckCircle2, 'Currently employed by the target organization.'],
  ['Years at Company', BriefcaseBusiness, 'Tenure indicating organizational context and credibility.'],
]

const steps = [
  ['01', 'Sign in', 'Access your secure workspace.'],
  ['02', 'Create a target search', 'Add the target’s accurate identity and context.'],
  ['03', 'Confirm a connection may exist', 'Validate a meaningful path through your available network.'],
  ['04', 'Run relationship discovery', 'Gather candidates and evaluate relationship signals.'],
  ['05', 'Review ranked candidates', 'Compare evidence, recommendations, and explanations.'],
  ['06', 'Choose the strongest path', 'Use the evidence to make a thoughtful human decision.'],
]

const sections = [
  ['network', 'Enter the network'], ['problem', 'The problem'], ['principle', 'Core principle'],
  ['usage', 'How it works'], ['input', 'Search input'], ['evidence', 'Evidence'],
  ['ranking', 'Ranking'], ['explain', 'Explainability'], ['workflow', 'Workflow'],
  ['workspace', 'Workspace'], ['value', 'Value'], ['responsible', 'Responsible use'], ['continue', 'Continue'],
]

function Section({ id, kicker, title, children, className = '' }) {
  return <section id={id} className={`wp-slide reveal-on-scroll ${className}`} data-presentation-section>
    <div className="wp-slide__inner">
      <p className="wp-kicker"><span />{kicker}</p>
      <h2>{title}</h2>
      {children}
    </div>
  </section>
}

function DeferredCommandCenterDemo() {
  const loaderRef = useRef(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setReady(true)
        observer.disconnect()
      }
    }, { rootMargin: '700px 0px' })
    observer.observe(loaderRef.current)
    return () => observer.disconnect()
  }, [])
  return <div className="cc-demo-loader" ref={loaderRef}>
    {ready ? <Suspense fallback={<div className="cc-demo-loading">ACTIVATING COMMAND CENTER...</div>}><CommandCenterDemo /></Suspense> : null}
  </div>
}

export function LoginPresentation({ onReturnToLogin }) {
  const rootRef = useRef(null)
  const [active, setActive] = useState('network')

  useEffect(() => {
    const root = rootRef.current
    const nodes = [...root.querySelectorAll('[data-presentation-section]')]
    const reveal = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('is-visible')
      entry.target.classList.toggle('is-active', entry.isIntersecting)
    }), { threshold: 0.16 })
    const track = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) setActive(visible.target.id)
    }, { rootMargin: '-30% 0px -55%', threshold: [0, 0.25, 0.6] })
    nodes.forEach((node) => { reveal.observe(node); track.observe(node) })
    return () => { reveal.disconnect(); track.disconnect() }
  }, [])

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
  })

  return <div className="wp-presentation" ref={rootRef}>
    <nav className="wp-progress" aria-label="Welcome presentation sections">
      {sections.map(([id, label]) => <button key={id} type="button" className={active === id ? 'is-active' : ''}
        onClick={() => scrollTo(id)} aria-label={`Go to ${label}`} title={label}><span /></button>)}
    </nav>

    <RelationshipNetworkSection />

    <Section id="problem" kicker="Signal fragmentation" title="Cold outreach ignores the network you already have.">
      <p className="wp-lead">A contact list cannot reveal the best introduction by itself. Warm Path Finder structures the overlap, ranks the options, and preserves the reason behind each recommendation.</p>
      <div className="wp-comparison">
        <article><p className="wp-panel-label">Without analysis</p><h3>Disconnected signals</h3>{['Manual research', 'Hidden overlap', 'Inconsistent decisions', 'No ranking explanation'].map((x) => <span key={x}><CircleDot />{x}</span>)}</article>
        <article className="is-resolved"><p className="wp-panel-label">With Warm Path Finder</p><h3>One explainable path</h3>{['Structured evidence', 'Ranked candidates', 'Automated workflow', 'Faster decisions'].map((x) => <span key={x}><CheckCircle2 />{x}</span>)}</article>
      </div>
    </Section>

    <CoreRequirementSection />

    <Section id="usage" kicker="Operating sequence" title="From target to warm path in five steps.">
      <div className="wp-timeline">{steps.map(([n, a, b]) => <article key={n}><b>{n}</b><h3>{a}</h3><p>{b}</p></article>)}</div>
    </Section>

    <Section id="input" kicker="Target identity" title="Start with accurate target information.">
      <p className="wp-lead">Accurate input improves discovery and reduces identity mismatches. Verify the target before the workflow begins.</p>
      <div className="wp-input-layout"><div className="wp-target-preview"><div className="wp-preview-head"><Target /> TARGET PROFILE <span>IDENTITY READY</span></div>{[
        ['Target name', 'Alex Morgan'], ['Current company', 'Northstar Technologies'], ['LinkedIn profile URL', 'linkedin.com/in/alex-morgan'], ['Location', 'Riyadh, Saudi Arabia'], ['Keywords', 'Enterprise systems'], ['Company filter', 'Optional'], ['School filter', 'Optional'],
      ].map(([a, b]) => <label key={a}><span>{a}</span><output>{b}</output></label>)}</div>
      <aside><h3>Before you search</h3>{['Verify the target’s identity.', 'Use the correct LinkedIn profile.', 'Confirm the current company.', 'Include location for common names.', 'Make sure a potential relationship path exists.'].map((x) => <p key={x}><CheckCircle2 />{x}</p>)}</aside></div>
    </Section>

    <Section id="evidence" kicker="Evidence layer" title="Every recommendation is built from evidence.">
      <p className="wp-lead">No single signal guarantees a relationship. The recommendation considers the combined evidence available for each path.</p>
      <div className="wp-evidence-grid">{evidence.map(([label, Icon, text], i) => <article key={label} className={i < 6 ? 'is-active' : ''}><Icon /><div><h3>{label}</h3><p>{text}</p></div><span>{i < 6 ? 'SIGNAL ACTIVE' : 'AVAILABLE'}</span></article>)}</div>
    </Section>

    <Section id="ranking" kicker="Candidate matrix" title="Candidates are ranked by relationship strength—not by appearance.">
      <p className="wp-lead">Illustrative examples show how combined signals support high, moderate, or limited recommendations. They are not production scores.</p>
      <div className="wp-rank-grid">{[
        ['A', 'Strong path', 'Same company · Current employee · Shared technologies · 6 years at company', 'High recommendation'],
        ['B', 'Moderate path', 'Same school · Same location · Experience overlap', 'Medium recommendation'],
        ['C', 'Limited path', 'One shared skill', 'Low recommendation'],
      ].map(([id, title, why, level]) => <details key={id}><summary><b>{id}</b><span><small>ILLUSTRATIVE</small><strong>{title}</strong><em>{level}</em></span><Link2 /></summary><div><h3>Why ranked?</h3><p>{why}</p></div></details>)}</div>
    </Section>

    <Section id="explain" kicker="Recommendation logic" title="Not just a score. A reason.">
      <div className="wp-explain"><div className="wp-avatar">AM</div><div><p className="wp-panel-label">Potential connector</p><h3>Jordan Lee</h3><p>Enterprise Systems Director</p></div><div className="wp-explain__signals"><span>Same company</span><span>Current employee</span><span>Shared technology</span><span>Long tenure</span></div><p className="wp-explain__reason">Jordan is surfaced because several relevant organizational signals combine into a stronger, more explainable potential path.</p></div>
    </Section>

    <Section id="workflow" kicker="Workflow status" title="From input to insight, every stage stays visible.">
      <div className="wp-pipeline">{[
        ['User Input', Target], ['Search Request', Search], ['Workflow Execution', Activity], ['Candidate Collection', Users], ['Relationship Evidence', Network], ['Candidate Ranking', Radar], ['Stored Results', Database], ['Dashboard', LayoutDashboard],
      ].map(([x, Icon], i) => <div key={x}><Icon /><span>{x}</span><small>0{i + 1}</small></div>)}</div>
    </Section>

    <Section id="workspace" kicker="Command center" title="One workspace for the entire discovery process.">
      <p className="wp-lead">Move from high-level intelligence to ranked paths, complete candidate review, workflow tracking, and a new target search—all inside one connected workspace.</p>
      <DeferredCommandCenterDemo />
    </Section>

    <Section id="value" kicker="Operational value" title="Turn relationship data into confident action.">
      <div className="wp-benefits">{[
        ['Faster discovery', 'Reduce time spent manually comparing profiles.'], ['Stronger introductions', 'Prioritize meaningful and relevant paths.'], ['Explainable decisions', 'Understand the evidence behind recommendations.'], ['Organized workflows', 'Track targets, candidates, runs, and results.'], ['Better preparation', 'Approach introductions with context, not guesswork.'],
      ].map(([a, b], i) => <article key={a}><b>0{i + 1}</b><h3>{a}</h3><p>{b}</p></article>)}</div>
    </Section>

    <Section id="responsible" kicker="Human verification" title="Relationship intelligence should remain human.">
      <div className="wp-responsible"><ShieldCheck /><div>{['Verify important information before acting.', 'Respect professional boundaries and privacy.', 'Never assume shared history guarantees a personal relationship.', 'Do not contact people deceptively.', 'Treat ranking as decision support—not absolute truth.', 'Confirm that a selected connector is comfortable helping.'].map((x) => <p key={x}><CheckCircle2 />{x}</p>)}</div></div>
      <blockquote>A meaningful warm path depends on a real relationship with the target.</blockquote>
    </Section>

    <Section id="continue" kicker="Path ready" title="Your strongest path may already exist." className="wp-slide--final">
      <p className="wp-lead">Sign in, define your target, validate the connection, and let Warm Path Finder reveal the most relevant route through your network.</p>
      <div className="wp-final-actions"><button type="button" className="button futuristic-action futuristic-action--cta" onClick={onReturnToLogin}><span>BE FINDER</span></button><button type="button" className="button button-secondary" onClick={() => scrollTo('usage')}>Review How It Works</button></div>
      <p className="wp-closing">Discover the connection. Understand the evidence. Choose the right path.</p>
    </Section>
  </div>
}

export function ScrollInvitation() {
  const go = () => document.getElementById('network')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  return <button type="button" className="wp-scroll-invitation" onClick={go}><span>Explore Warm Path Finder</span><ArrowDown aria-hidden="true" /></button>
}
