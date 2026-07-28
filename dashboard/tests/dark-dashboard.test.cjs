const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const sourceRoot = path.resolve(__dirname, '..', 'src')
const read = (...segments) => fs.readFileSync(path.join(sourceRoot, ...segments), 'utf8')

test('dark overview is an explicit theme variant and the existing light overview remains intact', () => {
  const overview = read('pages', 'Overview.jsx')
  const layout = read('layouts', 'AppLayout.jsx')

  assert.match(layout, /dashboardTheme,/)
  assert.match(overview, /dashboardTheme === 'dark'/)
  assert.match(overview, /<DarkDashboardPage/)

  // Existing light-only sections remain in the same component and are reached
  // after the explicit dark branch.
  assert.match(overview, /className="overview-hero"/)
  assert.match(overview, /className="grid stats-grid"/)
  assert.match(overview, /<CandidateCard candidate=\{candidate\}/)
  assert.match(overview, /className="table-wrap"/)
})

test('new dashboard presentation styles are scoped to the dark app-shell', () => {
  const styles = read('styles', 'darkDashboard.css')
  const selectorLines = styles.split(/\r?\n/).filter((line) => line.trim().endsWith('{'))
  for (const line of selectorLines) {
    const selector = line.trim().replace(/\s*\{$/, '')
    if (selector.startsWith('@') || /^(?:from|to|\d+%)/.test(selector)) continue
    assert.match(selector, /^\.app-shell\.dashboard-dark/, `Unscoped dark dashboard selector: ${selector}`)
  }

  assert.doesNotMatch(styles, /(?:^|\})\s*(?:body|main|\.dashboard h1|\.page-header|\.dashboard-card)\s*\{/m)
})

test('dark dashboard uses real routes, real progress logic, and neutral loading values', () => {
  const page = read('components', 'dark-dashboard', 'DarkDashboardPage.jsx')
  const hero = read('components', 'dark-dashboard', 'DarkDashboardHero.jsx')
  const sections = read('components', 'dark-dashboard', 'DarkDashboardSections.jsx')

  assert.match(hero, /to="\/find-target"/)
  assert.match(hero, /to="\/top-candidates"/)
  assert.match(page, /to="\/find-target"/)
  assert.match(sections, /getWorkflowProgressView\(activeRun\)/)
  assert.match(sections, /getWorkflowProgressView\(run\)/)
  assert.match(sections, /DASHBOARD_METRIC_DEFINITIONS\.map/)
  assert.match(sections, /const strongRelationshipsCount = totals\?\.strongRelationships/)
  assert.match(sections, /Number\.isFinite\(strongRelationshipsCount\) && strongRelationshipsCount > 0/)
  assert.match(sections, /formatDashboardMetricValue\(displayedValue, metric\)/)
  assert.doesNotMatch(sections, /Active Recent Runs|Total Candidates|Strong Relationship Paths/)
  assert.match(sections, /encodeRouteKey\(candidate\)/)
  assert.match(sections, /normalizeRelationshipEvidence\(getRelationshipEvidence\(candidate\)\)/)
})

test('dark graph renders real run-consistent connector data without generic path labels', () => {
  const page = read('components', 'dark-dashboard', 'DarkDashboardPage.jsx')
  const hero = read('components', 'dark-dashboard', 'DarkDashboardHero.jsx')
  const graph = read('utils', 'darkDashboardGraph.js')

  assert.match(page, /buildWarmPathGraphView\(data, \{ loading \}\)/)
  assert.match(graph, /candidateWorkflowRunId/)
  assert.match(graph, /String\(data\?\.candidateWorkflowRunId \|\| ''\) === workflowRunId/)
  assert.match(hero, /STRONGEST CONNECTOR/)
  assert.match(hero, /ALTERNATE CONNECTOR/)
  assert.match(hero, /connector\.evidence/)
  assert.match(hero, /graph\.accessibleSummary/)
  assert.doesNotMatch(hero, /PATH 01|PATH 02/)
})

test('dark graph detail cards are controlled by one active node for pointer, focus, and touch input', () => {
  const hero = read('components', 'dark-dashboard', 'DarkDashboardHero.jsx')
  const styles = read('styles', 'darkDashboard.css')

  assert.match(hero, /const \[activeNodeId, setActiveNodeId\] = useState\(null\)/)
  assert.match(hero, /onPointerEnter/)
  assert.match(hero, /onPointerLeave/)
  assert.match(hero, /onFocus/)
  assert.match(hero, /onBlur/)
  assert.match(hero, /pointerTypeRef\.current !== 'touch'/)
  assert.match(hero, /\{active \? <span className="dark-graph-tooltip"/)
  assert.match(hero, /activeNodeId === 'target'/)
  assert.match(styles, /\.dark-graph-node--connector\.is-primary \.dark-graph-node__core/)
  assert.match(styles, /\.dark-graph-tooltip \{[^}]*width:min\(300px/)
})
