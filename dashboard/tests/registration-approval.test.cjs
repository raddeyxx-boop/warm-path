const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const dashboardRoot = join(__dirname, '..')
const repositoryRoot = join(dashboardRoot, '..')
const readDashboard = (...parts) => readFileSync(join(dashboardRoot, ...parts), 'utf8')
const login = readDashboard('src', 'pages', 'Login.jsx')
const accountStatus = readDashboard('src', 'pages', 'AccountStatus.jsx')
const authProvider = readDashboard('src', 'auth', 'AuthProvider.jsx')
const protectedRoute = readDashboard('src', 'auth', 'ProtectedRoute.jsx')
const adminRoute = readDashboard('src', 'auth', 'AdminRoute.jsx')
const admin = readDashboard('src', 'pages', 'Admin.jsx')
const adminLayout = readDashboard('src', 'components', 'admin', 'AdminLayout.jsx')
const pendingUsersPanel = readDashboard('src', 'components', 'admin', 'PendingUsersPanel.jsx')
const adminService = readDashboard('src', 'services', 'adminUsers.js')
const app = readDashboard('src', 'App.jsx')
const migration = readFileSync(
  join(repositoryRoot, 'supabase', 'migrations', '202607230001_user_registration_approval.sql'),
  'utf8',
)
const edgeFunction = readFileSync(
  join(repositoryRoot, 'supabase', 'functions', 'admin-users', 'index.ts'),
  'utf8',
)
const css = readDashboard('src', 'index.css')

test('registration collects validated profile fields and uses Supabase Auth', () => {
  for (const label of ['Full Name', 'Email Address', 'Password', 'Contact Number']) {
    assert.match(login, new RegExp(label))
  }
  assert.match(login, /type="tel"/)
  assert.match(login, /Creating account\.\.\./)
  assert.match(login, /await auth\.signUp\(\{ fullName, email, password, contactNumber \}\)/)
  assert.match(authProvider, /supabase\.auth\.signUp/)
  assert.match(authProvider, /full_name: fullName\.trim\(\)/)
  assert.match(authProvider, /contact_number: contactNumber\.trim\(\)/)
  assert.doesNotMatch(migration, /password/i)
})

test('new profiles are securely created pending with a fixed user role', () => {
  assert.match(migration, /create or replace function public\.handle_new_auth_user/)
  assert.match(migration, /security definer[\s\S]*set search_path = public/)
  assert.match(migration, /'user',[\s\S]*true,[\s\S]*'pending'/)
  assert.match(migration, /approval_status in \('pending', 'approved', 'rejected'\)/)
  assert.match(migration, /update public\.profiles[\s\S]*approval_status = 'approved'/)
})

test('pending and rejected account routes cannot render protected dashboard content', () => {
  assert.match(app, /path="\/approval-pending"/)
  assert.match(app, /path="\/account-rejected"/)
  assert.match(protectedRoute, /approval_status === 'pending'[\s\S]*\/approval-pending/)
  assert.match(protectedRoute, /approval_status === 'rejected'[\s\S]*\/account-rejected/)
  assert.match(protectedRoute, /!auth\.isApproved/)
  assert.match(adminRoute, /approval_status !== 'approved'/)
  assert.match(accountStatus, /Approval in Progress/)
  assert.match(accountStatus, /Your account has been created successfully\./)
  assert.match(accountStatus, /Our administrators are reviewing your registration\./)
  assert.match(accountStatus, /You&apos;ll receive access immediately after approval\./)
})

test('RLS requires approved persisted profiles for dashboard data access', () => {
  assert.match(migration, /create or replace function public\.is_active_user\(\)/)
  assert.match(migration, /approval_status = 'approved'/)
  assert.match(migration, /public\.is_active_user\(\) and owner_user_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /using \(id = \(select auth\.uid\(\)\) or public\.is_admin\(\)\)/)
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i)
})

test('admin approval is authorized server-side and concurrency safe', () => {
  assert.match(edgeFunction, /const caller = await requireAdmin/)
  assert.match(edgeFunction, /action === 'approve_user'/)
  assert.match(edgeFunction, /\.eq\('approval_status', 'pending'\)/)
  assert.match(edgeFunction, /approved_by: caller\.user\.id/)
  assert.match(edgeFunction, /The pending user has already been processed/)
  assert.match(adminService, /export async function approveUser/)
  assert.match(pendingUsersPanel, /Pending Approval Queue/)
  assert.match(pendingUsersPanel, /'Approving\.\.\.' : 'Approve'/)
  assert.match(admin, /approvedUsers/)
})

test('pending requests can be deleted safely without deleting the Auth user', () => {
  assert.match(pendingUsersPanel, /<th>Actions<\/th><th>Delete<\/th>/)
  assert.match(pendingUsersPanel, /Delete pending request\?/)
  assert.match(pendingUsersPanel, /This action cannot be undone\./)
  assert.match(pendingUsersPanel, /'Deleting\.\.\.' : 'Delete'/)
  assert.match(adminService, /export async function deletePendingRequest/)
  assert.match(edgeFunction, /action === 'delete_pending_request'/)
  assert.match(edgeFunction, /\.from\('profiles'\)[\s\S]*\.delete\(\)[\s\S]*\.eq\('id', userId\)[\s\S]*\.eq\('approval_status', 'pending'\)/)
  assert.doesNotMatch(
    edgeFunction.match(/if \(action === 'delete_pending_request'\)[\s\S]*?return jsonResponse\(200, \{ success: true, deletedId: profile\.id \}\)/)?.[0] || '',
    /auth\.admin[\s\S]*deleteUser/,
  )
  assert.match(admin, /setPendingUsers\(\(current\) => current\.filter\(\(request\) => request\.id !== user\.id\)\)/)
  assert.match(admin, /Pending approval request deleted\./)
})

test('admin frontend and Edge Function share explicit action names and nested payloads', () => {
  for (const action of [
    'list_users',
    'create_user',
    'approve_user',
    'set_user_active',
    'set_user_role',
    'delete_user',
  ]) {
    assert.match(adminService, new RegExp(`['"]${action}['"]`))
    assert.match(edgeFunction, new RegExp(`['"]${action}['"]`))
  }
  assert.match(adminService, /action:\s*ADMIN_USER_ACTIONS\.CREATE_USER,[\s\S]*payload:\s*\{[\s\S]*email:[\s\S]*password:[\s\S]*fullName:[\s\S]*role:/)
  assert.match(adminService, /action:\s*ADMIN_USER_ACTIONS\.APPROVE_USER,[\s\S]*payload:\s*\{\s*userId\s*\}/)
  assert.match(edgeFunction, /const payload = body\.payload/)
  assert.match(edgeFunction, /UNKNOWN_ACTION[\s\S]*supportedActions:\s*ADMIN_USER_ACTIONS/)
  assert.match(edgeFunction, /MISSING_REQUIRED_FIELDS/)
  assert.doesNotMatch(adminService, /console\.(?:log|error)\([^)]*password/)
})

test('admin Edge Function receives a verified user session token explicitly', () => {
  assert.match(adminService, /await requireSupabaseSession\(\)/)
  assert.match(adminService, /jwtHeader\?\.alg === 'ES256' && !jwtHeader\.kid/)
  assert.match(adminService, /await supabase\.auth\.refreshSession\(\)/)
  assert.match(adminService, /Authorization:\s*`Bearer \$\{accessToken\}`/)
  assert.doesNotMatch(adminService, /Bearer \$\{(?:supabaseAnonKey|serviceRoleKey)\}/)
})

test('pending admin users come directly from pending profiles and query failures stay visible', () => {
  assert.match(adminService, /export async function listPendingUsers/)
  assert.match(adminService, /\.from\('profiles'\)/)
  assert.match(adminService, /\.select\('id, full_name, email, contact_number, approval_status, role, created_at'\)/)
  assert.match(adminService, /\.eq\('approval_status', 'pending'\)/)
  assert.doesNotMatch(adminService, /\.eq\('role'/)
  assert.match(adminService, /console\.error\('Admin pending profiles query failed:'/)
  assert.match(admin, /Promise\.allSettled\(\[[\s\S]*listPendingUsers\(\),[\s\S]*listUsers\(\)/)
  assert.match(pendingUsersPanel, /<strong key=\{users\.length\}>\{users\.length\}<\/strong>/)
  assert.match(pendingUsersPanel, /error \? <ErrorState/)
  assert.match(pendingUsersPanel, /users\.length \?/)
})

test('admin command shell exposes accessible desktop collapse and mobile drawer controls', () => {
  assert.match(adminLayout, /setTimeout\(\(\) => setCollapsed\(true\), 600\)/)
  assert.match(adminLayout, /Expand admin navigation/)
  assert.match(adminLayout, /Collapse admin navigation/)
  assert.match(adminLayout, /aria-expanded/)
  assert.match(adminLayout, /aria-current/)
  assert.match(adminLayout, /admin-drawer-overlay/)
  assert.match(adminLayout, /document\.body\.style\.overflow = 'hidden'/)
})

test('pending approval queue and admin table typography use the high-contrast command design', () => {
  assert.match(pendingUsersPanel, /ACCESS CONTROL/)
  assert.match(pendingUsersPanel, /Pending Approval Queue/)
  assert.match(pendingUsersPanel, /No Pending Requests/)
  assert.match(pendingUsersPanel, /Queue synchronized/)
  assert.match(css, /\.admin-command-shell \.admin-data-table th\s*\{[\s\S]*color:\s*#63d8ff/)
  assert.match(css, /\.admin-data-table \.admin-user-cell strong\s*\{[\s\S]*color:\s*#f5fbff/)
  assert.match(css, /\.admin-users-table td:nth-child\(2\)[\s\S]*color:\s*#b9d4e2/)
  assert.match(css, /\.admin-users-table td:nth-child\(3\)[\s\S]*color:\s*#a7c5d6/)
  assert.match(css, /\.admin-pending-command-panel\s*\{/)
})

test('admin initial refresh distinguishes loading placeholders from real zero counts', () => {
  assert.match(admin, /pendingCount=\{pendingLoaded \? pendingUsers\.length : null\}/)
  assert.match(admin, /approvedCount=\{usersLoaded \? approvedUsers\.length : null\}/)
  assert.match(pendingUsersPanel, /!loaded \? \(/)
  assert.match(pendingUsersPanel, /admin-queue-loading/)
  assert.match(pendingUsersPanel, /loaded && !error && !users\.length/)
  assert.doesNotMatch(pendingUsersPanel, /LoadingState/)
  assert.doesNotMatch(admin, /Last sync pending/)
  assert.match(css, /\.admin-count-placeholder/)
})

test('registration layout uses a compact two-column desktop grid with a mobile fallback', () => {
  assert.match(login, /auth-panel-register/)
  assert.match(login, /auth-form-register/)
  assert.match(css, /\.auth-panel-register\s*\{[\s\S]*grid-template-columns:\s*minmax\(620px,\s*52%\)/)
  assert.match(css, /\.auth-form-register\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /\.auth-form-register input\s*\{[\s\S]*height:\s*54px/)
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.auth-form-register\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.doesNotMatch(css, /\.auth-panel-register[\s\S]{0,200}overflow-y:\s*auto/)
})

test('login mode locks only its desktop hero to the viewport with a short-height fallback', () => {
  assert.match(login, /auth-page-login/)
  assert.match(login, /auth-panel-login/)
  assert.match(login, /auth-form-login/)
  assert.match(css, /@media \(min-width: 821px\) and \(min-height: 620px\)[\s\S]*\.auth-page-welcome\.auth-page-login\s*\{[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/)
  assert.match(css, /\.auth-panel-login\s*\{[\s\S]*grid-template-columns:\s*minmax\(480px,\s*38%\)/)
  assert.match(css, /\.auth-form-login input\s*\{[\s\S]*height:\s*56px/)
  assert.match(css, /\.auth-panel-login \.auth-marketing-side > :not\(\.auth-network\)\s*\{[\s\S]*opacity:\s*1/)
  assert.match(css, /@media \(max-height: 619px\)[\s\S]*\.auth-page-welcome\.auth-page-login\s*\{[\s\S]*height:\s*auto[\s\S]*overflow-y:\s*auto/)
  assert.match(css, /\.auth-page-welcome\s*\{[\s\S]*overflow-y:\s*auto/)
})

test('approval status uses the mission-control glass interface without changing refresh behavior', () => {
  assert.match(accountStatus, /approval-glass-panel/)
  assert.match(accountStatus, /approval-scanner-ring-outer/)
  assert.match(accountStatus, /Waiting for Administrator Review/)
  assert.match(accountStatus, /Successfully Submitted/)
  assert.match(accountStatus, /Email verification and administrator approval are independent processes\./)
  assert.match(accountStatus, /Still waiting for administrator approval\./)
  assert.match(accountStatus, /await auth\.refreshProfile\(\)/)
  assert.match(css, /\.account-status-page\s*\{[\s\S]*height:\s*100dvh;[\s\S]*overflow:\s*visible;/)
  assert.match(css, /\.approval-command-layout\s*\{[\s\S]*display:\s*flex;/)
  assert.match(css, /\.approval-glass-panel\s*\{[\s\S]*backdrop-filter:\s*blur\(24px\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important/)
  assert.doesNotMatch(accountStatus, /account-status-card/)
})
