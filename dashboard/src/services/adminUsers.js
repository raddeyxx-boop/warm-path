import { supabase } from '../lib/supabase'
import { requireSupabaseSession } from './authSession'

export const ADMIN_USER_ACTIONS = Object.freeze({
  LIST_USERS: 'list_users',
  CREATE_USER: 'create_user',
  APPROVE_USER: 'approve_user',
  DELETE_PENDING_REQUEST: 'delete_pending_request',
  SET_USER_ACTIVE: 'set_user_active',
  SET_USER_ROLE: 'set_user_role',
  DELETE_USER: 'delete_user',
})

async function readFunctionError(error) {
  const response = error?.context
  if (!response || typeof response.clone !== 'function') return ''

  try {
    const body = await response.clone().json()
    return body?.message || body?.error || ''
  } catch {
    try {
      return await response.clone().text()
    } catch {
      return ''
    }
  }
}

function readJwtHeader(token) {
  try {
    const encodedHeader = String(token || '').split('.')[0]
    if (!encodedHeader) return null
    const base64 = encodedHeader.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
  } catch {
    return null
  }
}

async function requireAdminAccessToken() {
  let session = await requireSupabaseSession()
  const jwtHeader = readJwtHeader(session.access_token)

  if (jwtHeader?.alg === 'ES256' && !jwtHeader.kid) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session?.access_token) {
      throw new Error('Your session could not be refreshed. Please sign in again.')
    }
    session = data.session
  }

  return session.access_token
}

export async function invokeAdminUsers(payload) {
  const accessToken = await requireAdminAccessToken()
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: payload,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (error) {
    if (import.meta.env.DEV) console.error('Admin Edge Function:', error)
    const functionMessage = await readFunctionError(error)
    if (functionMessage) throw new Error(functionMessage)
    if (error.name === 'FunctionsFetchError' || error.message === 'Failed to send a request to the Edge Function') {
      throw new Error('Admin Edge Function is unavailable. Deploy supabase/functions/admin-users and set its Supabase secrets.')
    }
    throw new Error(error.message || 'Admin request failed.')
  }
  if (!data?.success) throw new Error(data?.message || data?.error || 'Admin request failed.')
  return data
}

export async function listUsers() {
  const data = await invokeAdminUsers({ action: ADMIN_USER_ACTIONS.LIST_USERS, payload: {} })
  return data.users || []
}

export async function listPendingUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, contact_number, approval_status, role, created_at')
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Admin pending profiles query failed:', error)
    throw new Error(error.message || 'Could not load pending users.')
  }

  return data || []
}

export async function createUser({ email, password, fullName = '', contactNumber = '', role = 'user' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedPassword = String(password || '')
  const normalizedFullName = String(fullName || '').trim()
  const normalizedContactNumber = String(contactNumber || '').trim()
  const normalizedRole = role === 'admin' ? 'admin' : 'user'

  if (!normalizedEmail || !normalizedPassword || !normalizedFullName || !normalizedRole) {
    throw new Error('Email, password, full name, and role are required.')
  }

  const data = await invokeAdminUsers({
    action: ADMIN_USER_ACTIONS.CREATE_USER,
    payload: {
      email: normalizedEmail,
      password: normalizedPassword,
      fullName: normalizedFullName,
      contactNumber: normalizedContactNumber,
      role: normalizedRole,
    },
  })
  return data.user
}

export async function approveUser(userId) {
  const data = await invokeAdminUsers({
    action: ADMIN_USER_ACTIONS.APPROVE_USER,
    payload: { userId },
  })
  return data.user
}

export async function deletePendingRequest(userId) {
  return invokeAdminUsers({
    action: ADMIN_USER_ACTIONS.DELETE_PENDING_REQUEST,
    user_id: userId,
  })
}

export async function setUserActive(userId, isActive) {
  const data = await invokeAdminUsers({
    action: ADMIN_USER_ACTIONS.SET_USER_ACTIVE,
    payload: { userId, isActive },
  })
  return data.user
}

export async function setUserRole(userId, role) {
  const data = await invokeAdminUsers({
    action: ADMIN_USER_ACTIONS.SET_USER_ROLE,
    payload: { userId, role },
  })
  return data.user
}

export async function deleteUser(userId) {
  return invokeAdminUsers({
    action: ADMIN_USER_ACTIONS.DELETE_USER,
    payload: { userId },
  })
}
