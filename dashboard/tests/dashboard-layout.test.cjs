const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const layoutSource = fs.readFileSync(path.join(root, 'src/layouts/AppLayout.jsx'), 'utf8')
const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const cssSource = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8')

test('authenticated shell restores the original shared sidebar navigation', () => {
  assert.match(layoutSource, /function Sidebar/)
  assert.match(layoutSource, /<aside/)
  assert.match(layoutSource, /aria-label="Primary navigation"/)
  assert.match(layoutSource, /Warm Path Finder/)
  assert.match(layoutSource, /Relationship intelligence/)
  assert.doesNotMatch(layoutSource, /className="dashboard-nav"/)

  const expectedDestinations = [
    ['/dashboard', 'Overview'],
    ['/top-candidates', 'Top Candidates'],
    ['/candidates', 'All Candidates'],
    ['/runs', 'Workflow Runs'],
    ['/find-target', 'Find a New Target'],
  ]

  for (const [route, label] of expectedDestinations) {
    assert.match(layoutSource, new RegExp(`to: '${route}'`))
    assert.match(layoutSource, new RegExp(`label: '${label}'`))
  }
})

test('sidebar grid offset and responsive drawer behavior are restored', () => {
  assert.match(cssSource, /--sidebar-track:\s*0px/)
  assert.match(cssSource, /grid-template-columns:\s*var\(--sidebar-track\)\s+minmax\(0,\s*1fr\)/)
  assert.match(cssSource, /\.app-shell\.sidebar-is-visible\s*\{[^}]*--sidebar-track:\s*318px/s)
  assert.match(cssSource, /\.main-shell\s*\{[^}]*grid-column:\s*2/s)
  assert.match(cssSource, /\.drawer-scrim\s*\{/)
  assert.match(cssSource, /\.sidebar-open\s*\{/)
  assert.match(layoutSource, /aria-label="Open navigation"/)
  assert.match(layoutSource, /aria-label="Close navigation"/)
})

test('all authenticated routes remain under the shared layout', () => {
  for (const route of [
    'dashboard',
    'top-candidates',
    'candidates',
    'candidates/:id',
    'runs',
    'runs/:id',
    'find-target',
  ]) {
    assert.match(appSource, new RegExp(`path="${route}"`))
  }
})

test('authenticated page scrollbars are hidden without disabling scrolling', () => {
  assert.match(layoutSource, /document\.documentElement\.classList\.add\('dashboard-scrollbar-hidden'\)/)
  assert.match(layoutSource, /document\.body\.classList\.add\('dashboard-scrollbar-hidden'\)/)
  assert.match(layoutSource, /document\.documentElement\.classList\.remove\('dashboard-scrollbar-hidden'\)/)
  assert.match(layoutSource, /document\.body\.classList\.remove\('dashboard-scrollbar-hidden'\)/)

  assert.match(cssSource, /\.main-shell\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s)
  assert.match(cssSource, /html\.dashboard-scrollbar-hidden/)
  assert.match(cssSource, /body\.dashboard-scrollbar-hidden/)
  assert.doesNotMatch(cssSource, /\*\s*::?-webkit-scrollbar/)
})
