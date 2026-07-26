const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const sourceRoot = join(__dirname, '..', 'src')
const appSource = readFileSync(join(sourceRoot, 'App.jsx'), 'utf8')
const loginSource = readFileSync(join(sourceRoot, 'pages', 'Login.jsx'), 'utf8')
const protectedRouteSource = readFileSync(join(sourceRoot, 'auth', 'ProtectedRoute.jsx'), 'utf8')

test('root renders Landing and login remains free of authenticated-session redirects', () => {
  assert.match(appSource, /<Route path="\/" element=\{<Landing \/>\} \/>/)
  assert.match(appSource, /<Route path="\/login" element=\{<Login \/>\} \/>/)
  assert.doesNotMatch(loginSource, /useEffect\s*\(/)
  assert.doesNotMatch(loginSource, /auth\.isAuthenticated/)
})

test('dashboard navigation remains owned by explicit login submission', () => {
  const signInIndex = loginSource.indexOf('await auth.signIn(email, password)')
  const navigateIndex = loginSource.indexOf('navigate(destination, { replace: true })')

  assert.notEqual(signInIndex, -1)
  assert.ok(navigateIndex > signInIndex)
})

test('protected routes still reject missing sessions', () => {
  assert.match(protectedRouteSource, /if \(!auth\.isAuthenticated\)/)
  assert.match(protectedRouteSource, /<Navigate to="\/login" replace/)
})
