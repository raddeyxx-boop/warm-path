/// <reference lib="deno.ns" />

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const ADMIN_USER_ACTIONS = [
  'list_users',
  'create_user',
  'approve_user',
  'set_user_active',
  'set_user_role',
  'delete_user',
] as const

type AdminUserAction = typeof ADMIN_USER_ACTIONS[number]

const VALID_ACTIONS = new Set<AdminUserAction>(ADMIN_USER_ACTIONS)
const VALID_ROLES = new Set(['admin', 'user'])

type Role = 'admin' | 'user'

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  })
}

function errorResponse(
  status: number,
  error: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return jsonResponse(status, {
    success: false,
    error,
    message,
    ...details,
  })
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)

  if (!value) {
    throw new Error(`Missing ${name}`)
  }

  return value
}

function isEmail(value: unknown) {
  return (
    typeof value === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
}

function validateAction(
  body: Record<string, unknown>,
): AdminUserAction {
  const action = String(body.action || '')

  if (!VALID_ACTIONS.has(action as AdminUserAction)) {
    throw errorResponse(
      400,
      'UNKNOWN_ACTION',
      `Unsupported admin action: ${action || '(missing)'}`,
      {
        supportedActions: ADMIN_USER_ACTIONS,
      },
    )
  }

  return action as AdminUserAction
}

function sanitizeUser(authUser: any, profile: any = {}) {
  return {
    id: authUser.id,
    email: profile.email ?? authUser.email ?? null,
    full_name:
      profile.full_name ??
      authUser.user_metadata?.full_name ??
      null,
    contact_number:
      profile.contact_number ??
      authUser.user_metadata?.contact_number ??
      null,
    role: profile.role ?? 'user',
    is_active: profile.is_active ?? true,
    approval_status: profile.approval_status ?? 'pending',
    approved_at: profile.approved_at ?? null,
    approved_by: profile.approved_by ?? null,
    created_at:
      profile.created_at ??
      authUser.created_at ??
      null,
    last_sign_in_at: authUser.last_sign_in_at ?? null,
  }
}

async function requireAdmin(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
) {
  const authorization =
    req.headers.get('Authorization') || ''

  if (!authorization.startsWith('Bearer ')) {
    throw errorResponse(
      401,
      'AUTH_REQUIRED',
      'Missing bearer token.',
    )
  }

  const userClient = createClient(
    supabaseUrl,
    anonKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    },
  )

  const {
    data: userData,
    error: userError,
  } = await userClient.auth.getUser()

  if (userError || !userData.user) {
    throw errorResponse(
      401,
      'INVALID_SESSION',
      'Invalid session.',
    )
  }

  const {
    data: profile,
    error: profileError,
  } = await userClient
    .from('profiles')
    .select(
      'id, email, full_name, role, is_active, approval_status, created_at, updated_at',
    )
    .eq('id', userData.user.id)
    .single()

  if (profileError || !profile) {
    throw errorResponse(
      403,
      'ADMIN_PROFILE_NOT_FOUND',
      'Administrator profile was not found.',
    )
  }

  if (
    profile.role !== 'admin' ||
    profile.is_active !== true ||
    profile.approval_status !== 'approved'
  ) {
    throw errorResponse(
      403,
      'ADMIN_REQUIRED',
      'Administrator access is required.',
    )
  }

  return {
    user: userData.user,
    profile,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  if (req.method !== 'POST') {
    return errorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Method not allowed.',
    )
  }

  try {
    const supabaseUrl =
      requireEnv('SUPABASE_URL')

    const anonKey =
      requireEnv('SUPABASE_ANON_KEY')

    const serviceRoleKey =
      requireEnv('SUPABASE_SERVICE_ROLE_KEY')

    const caller = await requireAdmin(
      req,
      supabaseUrl,
      anonKey,
    )

    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
    )

    const body = await req
      .json()
      .catch(() => ({}))

    const action = validateAction(body)

    const payload =
      body.payload &&
      typeof body.payload === 'object'
        ? body.payload as Record<string, unknown>
        : {}

    if (action === 'list_users') {
      const users: any[] = []
      let page = 1
      const perPage = 1000

      while (true) {
        const {
          data,
          error,
        } = await adminClient.auth.admin.listUsers({
          page,
          perPage,
        })

        if (error) {
          throw error
        }

        users.push(...(data.users || []))

        if (
          !data.users?.length ||
          data.users.length < perPage
        ) {
          break
        }

        page += 1
      }

      const {
        data: profiles,
        error: profilesError,
      } = await adminClient
        .from('profiles')
        .select(
          'id, email, full_name, contact_number, role, is_active, approval_status, approved_at, approved_by, created_at',
        )

      if (profilesError) {
        throw profilesError
      }

      const profileById = new Map(
        (profiles || []).map((profile: any) => [
          profile.id,
          profile,
        ]),
      )

      return jsonResponse(200, {
        success: true,
        users: users.map((user) =>
          sanitizeUser(
            user,
            profileById.get(user.id),
          )
        ),
      })
    }

    if (action === 'create_user') {
      const email = String(
        payload.email || '',
      )
        .trim()
        .toLowerCase()

      const password = String(
        payload.password || '',
      )

      const fullName = String(
        payload.fullName || '',
      ).trim()

      const contactNumber = String(
        payload.contactNumber || '',
      ).trim()

      const role = String(
        payload.role || '',
      ) as Role

      if (
        !email ||
        !password ||
        !fullName ||
        !role
      ) {
        return errorResponse(
          400,
          'MISSING_REQUIRED_FIELDS',
          'Email, password, full name, and role are required.',
        )
      }

      if (!isEmail(email)) {
        return errorResponse(
          400,
          'INVALID_EMAIL',
          'Enter a valid email address.',
        )
      }

      if (password.length < 8) {
        return errorResponse(
          400,
          'INVALID_PASSWORD',
          'Password must be at least 8 characters.',
        )
      }

      if (!VALID_ROLES.has(role)) {
        return errorResponse(
          400,
          'INVALID_ROLE',
          'Role must be admin or user.',
        )
      }

      const {
        data: created,
        error: createError,
      } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          contact_number: contactNumber,
        },
      })

      if (createError) {
        const duplicate =
          /already|registered|exists/i.test(
            createError.message || '',
          )

        return errorResponse(
          duplicate ? 409 : 400,
          duplicate
            ? 'USER_ALREADY_EXISTS'
            : 'AUTH_USER_CREATE_FAILED',
          duplicate
            ? 'A user with this email already exists.'
            : createError.message ||
              'Unable to create the user.',
        )
      }

      if (!created.user) {
        return errorResponse(
          500,
          'AUTH_USER_CREATE_FAILED',
          'Unable to create the user.',
        )
      }

      const {
        data: profile,
        error: profileError,
      } = await adminClient
        .from('profiles')
        .upsert({
          id: created.user.id,
          email,
          full_name: fullName,
          contact_number:
            contactNumber || null,
          role,
          is_active: true,
          approval_status: 'approved',
          approved_at:
            new Date().toISOString(),
          approved_by: caller.user.id,
        })
        .select(
          'id, email, full_name, contact_number, role, is_active, approval_status, approved_at, approved_by, created_at',
        )
        .single()

      if (profileError) {
        await adminClient.auth.admin
          .deleteUser(created.user.id)
          .catch(() => null)

        return errorResponse(
          500,
          'PROFILE_CREATE_FAILED',
          'Unable to create the profile.',
        )
      }

      return jsonResponse(200, {
        success: true,
        user: sanitizeUser(
          created.user,
          profile,
        ),
      })
    }

    if (action === 'approve_user') {
      const userId = String(
        payload.userId || '',
      )

      if (!userId) {
        return errorResponse(
          400,
          'MISSING_USER_ID',
          'A user ID is required.',
        )
      }

      const {
        data: profile,
        error,
      } = await adminClient
        .from('profiles')
        .update({
          approval_status: 'approved',
          approved_at:
            new Date().toISOString(),
          approved_by: caller.user.id,
          rejected_at: null,
          rejected_by: null,
        })
        .eq('id', userId)
        .eq(
          'approval_status',
          'pending',
        )
        .select(
          'id, email, full_name, contact_number, role, is_active, approval_status, approved_at, approved_by, created_at',
        )
        .maybeSingle()

      if (error) {
        throw error
      }

      if (!profile) {
        return errorResponse(
          409,
          'REGISTRATION_ALREADY_PROCESSED',
          'The pending user has already been processed.',
        )
      }

      return jsonResponse(200, {
        success: true,
        user: profile,
      })
    }

    if (action === 'set_user_active') {
      const userId = String(
        payload.userId || '',
      )

      const isActive = Boolean(
        payload.isActive,
      )

      if (!userId) {
        return errorResponse(
          400,
          'MISSING_USER_ID',
          'A user ID is required.',
        )
      }

      if (
        userId === caller.user.id &&
        !isActive
      ) {
        return errorResponse(
          400,
          'SELF_DEACTIVATION_FORBIDDEN',
          'Administrators cannot deactivate their own account.',
        )
      }

      const {
        data: profile,
        error,
      } = await adminClient
        .from('profiles')
        .update({
          is_active: isActive,
        })
        .eq('id', userId)
        .select(
          'id, email, full_name, contact_number, role, is_active, approval_status, approved_at, approved_by, created_at',
        )
        .single()

      if (error) {
        throw error
      }

      return jsonResponse(200, {
        success: true,
        user: profile,
      })
    }

    if (action === 'set_user_role') {
      const userId = String(
        payload.userId || '',
      )

      const role = String(
        payload.role || '',
      ) as Role

      if (!userId) {
        return errorResponse(
          400,
          'MISSING_USER_ID',
          'A user ID is required.',
        )
      }

      if (!VALID_ROLES.has(role)) {
        return errorResponse(
          400,
          'INVALID_ROLE',
          'Role must be admin or user.',
        )
      }

      if (
        userId === caller.user.id &&
        role !== 'admin'
      ) {
        return errorResponse(
          400,
          'SELF_DEMOTION_FORBIDDEN',
          'Administrators cannot demote their own account.',
        )
      }

      const {
        data: profile,
        error,
      } = await adminClient
        .from('profiles')
        .update({
          role,
        })
        .eq('id', userId)
        .select(
          'id, email, full_name, contact_number, role, is_active, approval_status, approved_at, approved_by, created_at',
        )
        .single()

      if (error) {
        throw error
      }

      return jsonResponse(200, {
        success: true,
        user: profile,
      })
    }

    if (action === 'delete_user') {
      const userId = String(
        payload.userId || '',
      )

      if (!userId) {
        return errorResponse(
          400,
          'MISSING_USER_ID',
          'A user ID is required.',
        )
      }

      if (userId === caller.user.id) {
        return errorResponse(
          400,
          'SELF_DELETE_FORBIDDEN',
          'Administrators cannot delete their own account.',
        )
      }

      const {
        error,
      } = await adminClient.auth.admin
        .deleteUser(userId)

      if (error) {
        throw error
      }

      return jsonResponse(200, {
        success: true,
      })
    }

    return errorResponse(
      400,
      'UNKNOWN_ACTION',
      `Unsupported admin action: ${String(action)}`,
      {
        supportedActions: ADMIN_USER_ACTIONS,
      },
    )
  } catch (error) {
    if (error instanceof Response) {
      return error
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Admin request failed.'

    return errorResponse(
      500,
      'ADMIN_REQUEST_FAILED',
      message,
    )
  }
})