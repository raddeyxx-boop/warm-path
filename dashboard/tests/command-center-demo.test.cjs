const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const root = join(__dirname, '..', 'src')
const presentation = readFileSync(join(root, 'components', 'login', 'LoginPresentation.jsx'), 'utf8')
const demo = readFileSync(join(root, 'components', 'login', 'CommandCenterDemo.jsx'), 'utf8')
const css = readFileSync(join(root, 'index.css'), 'utf8')

test('command center lazily loads a presentation-only five-page walkthrough', () => {
  assert.match(presentation, /lazy\(\(\) => import\('\.\/CommandCenterDemo'\)\)/)
  assert.match(presentation, /rootMargin: '700px 0px'/)
  for (const label of ['Overview', 'Top Candidates', 'All Candidates', 'Workflow Runs', 'Find a New Target']) {
    assert.match(demo, new RegExp(label))
  }
  assert.doesNotMatch(demo, /supabase|fetch\(|useNavigate|<iframe/i)
})

test('walkthrough autoplay is visibility-aware without visible transport controls', () => {
  assert.match(demo, /IntersectionObserver/)
  assert.match(demo, /visibilitychange/)
  assert.match(demo, /prefers-reduced-motion: reduce/)
  assert.match(demo, /setTimeout\(\(\) => setManualPause\(false\), 8000\)/)
  assert.doesNotMatch(demo, /cc-controls|cc-timeline/)
  assert.doesNotMatch(demo, /Pause walkthrough|Replay walkthrough|Previous demo page|Next demo page/)
  assert.match(demo, /aria-current/)
})

test('walkthrough uses fictional sanitized demo data and responsive presentation styles', () => {
  for (const value of ['Maya Rao', 'Daniel Chen', 'Sara Malik', 'Alex Morgan', 'Northstar Technologies']) {
    assert.match(demo, new RegExp(value))
  }
  assert.match(demo, /LIVE DEMO · FICTIONAL DATA/)
  assert.match(css, /\.cc-frame/)
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.cc-sidebar/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cc-scan/)
})
