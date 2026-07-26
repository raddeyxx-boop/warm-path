const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const sourceRoot = join(__dirname, '..', 'src')
const runDetailsSource = readFileSync(join(sourceRoot, 'pages', 'RunDetails.jsx'), 'utf8')
const styles = readFileSync(join(sourceRoot, 'index.css'), 'utf8')

test('delete confirmation is portaled to document.body', () => {
  assert.match(runDetailsSource, /createPortal\s*\(/)
  assert.match(runDetailsSource, /document\.body\s*,\s*\)/)
})

test('delete confirmation locks body scrolling and restores the prior value', () => {
  assert.match(runDetailsSource, /const previousOverflow = document\.body\.style\.overflow/)
  assert.match(runDetailsSource, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(runDetailsSource, /document\.body\.style\.overflow = previousOverflow/)
})

test('delete confirmation supports guarded backdrop and Escape dismissal', () => {
  assert.match(runDetailsSource, /event\.key === 'Escape' && !isDeleting/)
  assert.match(runDetailsSource, /event\.target === event\.currentTarget && !isDeleting/)
  assert.match(runDetailsSource, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/)
})

test('delete confirmation is fixed, viewport-centered, and internally scrollable', () => {
  assert.match(styles, /\.modal-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s)
  assert.match(styles, /\.delete-modal-backdrop\s*\{[^}]*z-index:\s*9999;[^}]*width:\s*100vw;[^}]*height:\s*100dvh;[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s)
  assert.match(styles, /\.delete-confirmation-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 48px\);[^}]*overflow-y:\s*auto;/s)
})
