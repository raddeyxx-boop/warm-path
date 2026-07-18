import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const VALID_ACTIONS = new Set(['list', 'create', 'set-active', 'set-role', 'delete'])
const VALID_ROLES = new Set(['admin', 'user'])

type Role = 'admin' | 'user'

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  })
}

function errorResponse(status: number, error: string) {
  return jsonResponse(status, { success: false, error })
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function isEmail(value: unknown) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function validateAction(body: Record<string, unknown>) {
  const action = String(body.action || '')
  if (!VALID_ACTIONS.has(action)) {
    throw errorResponse(400, 'Unknown action.')
  }
  return action
}

function sanitizeUser(authUser: any, profile: any = {}) {
  return {
    id: authUser.id,
    email: profile.email ?? authUser.email ?? null,
    full_name: profile.full_name ?? authUser.user_metadata?.full_name ?? null,
    role: profile.role ?? 'user',
    is_active: profile.is_active ?? true,
    created_at: profile.created_at ?? authUser.created_at ?? null,
    last_sign_in_at: authUser.last_sign_in_at ?? null,
  }
}

async function requireAdmin(req: Request, supabaseUrl: string, anonKey: string) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) {
    throw errorResponse(401, 'Missing bearer token.')
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    throw errorResponse(401, 'Invalid session.')
  }

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .eq('id', userData.user.id)
    .single()

  if (profileError || !profile) {
    throw errorResponse(403, 'Administrator profile was not found.')
  }

  if (profile.role !== 'admin' || profile.is_active !== true) {
    throw errorResponse(403, 'Administrator access required.')
  }

  return { user: userData.user, profile }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse(405, 'Method not allowed.')

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const anonKey = requireEnv('SUPABASE_ANON_KEY')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const caller = await requireAdmin(req, supabaseUrl, anonKey)
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const body = await req.json().catch(() => ({}))
    const action = validateAction(body)

    if (action === 'list') {
      const users: any[] = []
      let page = 1
      const perPage = 1000

      while (true) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
        if (error) throw error
        users.push(...(data.users || []))
        if (!data.users?.length || data.users.length < perPage) break
        page += 1
      }

      const { data: profiles, error: profilesError } = await adminClient
        .from('profiles')
        .select('id, email, full_name, role, is_active, created_at')

      if (profilesError) throw profilesError
      const profileById = new Map((profiles || []).map((profile: any) => [profile.id, profile]))

      return jsonResponse(200, {
        success: true,
        users: users.map((user) => sanitizeUser(user, profileById.get(user.id))),
      })
    }

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const fullName = String(body.fullName || '').trim()
      const role: Role = body.role === 'admin' ? 'admin' : 'user'

      if (!isEmail(email)) return errorResponse(400, 'Enter a valid email address.')
      if (password.length < 8) return errorResponse(400, 'Password must be at least 8 characters.')
      if (!VALID_ROLES.has(role)) return errorResponse(400, 'Invalid role.')

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })

      if (createError || !created.user) throw createError || new Error('User was not created.')

      const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .upsert({
          id: created.user.id,
          email,
          full_name: fullName,
          role,
          is_active: true,
        })
        .select('id, email, full_name, role, is_active, created_at')
        .single()

      if (profileError) {
        await adminClient.auth.admin.deleteUser(created.user.id).catch(() => null)
        throw profileError
      }

      return jsonResponse(200, { success: true, user: sanitizeUser(created.user, profile) })
    }

    if (action === 'set-active') {
      const userId = String(body.userId || '')
      const isActive = Boolean(body.isActive)
      if (!userId) return errorResponse(400, 'Missing userId.')
      if (userId === caller.user.id && !isActive) {
        return errorResponse(400, 'Admins cannot deactivate their own account.')
      }

      const { data: profile, error } = await adminClient
        .from('profiles')
        .update({ is_active: isActive })
        .eq('id', userId)
        .select('id, email, full_name, role, is_active, created_at')
        .single()

      if (error) throw error
      return jsonResponse(200, { success: true, user: profile })
    }

    if (action === 'set-role') {
      const userId = String(body.userId || '')
      const role = String(body.role || '') as Role
      if (!userId) return errorResponse(400, 'Missing userId.')
      if (!VALID_ROLES.has(role)) return errorResponse(400, 'Invalid role.')
      if (userId === caller.user.id && role !== 'admin') {
        return errorResponse(400, 'Admins cannot demote their own account.')
      }

      const { data: profile, error } = await adminClient
        .from('profiles')
        .update({ role })
        .eq('id', userId)
        .select('id, email, full_name, role, is_active, created_at')
        .single()

      if (error) throw error
      return jsonResponse(200, { success: true, user: profile })
    }

    if (action === 'delete') {
      const userId = String(body.userId || '')
      if (!userId) return errorResponse(400, 'Missing userId.')
      if (userId === caller.user.id) {
        return errorResponse(400, 'Admins cannot delete their own account.')
      }

      const { error } = await adminClient.auth.admin.deleteUser(userId)
      if (error) throw error
      return jsonResponse(200, { success: true })
    }

    return errorResponse(400, 'Unknown action.')
  } catch (error) {
    if (error instanceof Response) return error
    return errorResponse(500, error?.message || 'Admin request failed.')
  }
})
