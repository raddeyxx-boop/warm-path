const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const dataSource = fs.readFileSync(path.join(__dirname, '../src/services/supabaseData.js'), 'utf8')
const layoutSource = fs.readFileSync(path.join(__dirname, '../src/layouts/AppLayout.jsx'), 'utf8')
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/202607210002_strict_owner_select_isolation.sql'), 'utf8')

test('dashboard resolves the authenticated owner and explicitly scopes owned tables', () => {
  assert.match(dataSource, /client\.auth\.getUser\(\)/)
  for (const table of ['workflow_runs', 'ranked_candidates', 'top_candidates']) {
    assert.match(dataSource, new RegExp(`from\\('${table}'\\)`))
  }
  assert.ok((dataSource.match(/\.eq\('owner_user_id'/g) || []).length >= 12)
})

test('dashboard routes remount when the authenticated user changes', () => {
  assert.match(layoutSource, /<Outlet key=\{auth\.user\?\.id\}/)
})

test('RLS migration restricts all dashboard result tables to auth uid', () => {
  for (const table of ['workflow_runs', 'ranked_candidates', 'top_candidates', 'search_requests', 'candidate_relationships', 'workflow_summary']) {
    assert.match(migration, new RegExp(`'${table}'`))
  }
  assert.match(migration, /owner_user_id = \(select auth\.uid\(\)\)/)
  assert.doesNotMatch(migration, /is_admin/)
})
