import { supabase } from '../lib/supabase'

async function readFunctionError(error) {
  const response = error?.context
  if (!response || typeof response.clone !== 'function') return ''

  try {
    const body = await response.clone().json()
    return body?.error || body?.message || ''
  } catch {
    try {
      return await response.clone().text()
    } catch {
      return ''
    }
  }
}

export async function invokeAdminUsers(payload) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: payload,
  })

  if (error) {
    console.error('Admin Edge Function:', error)
    const functionMessage = await readFunctionError(error)
    if (functionMessage) throw new Error(functionMessage)
    if (error.name === 'FunctionsFetchError' || error.message === 'Failed to send a request to the Edge Function') {
      throw new Error('Admin Edge Function is unavailable. Deploy supabase/functions/admin-users and set its Supabase secrets.')
    }
    throw new Error(error.message || 'Admin request failed.')
  }
  if (!data?.success) throw new Error(data?.error || 'Admin request failed.')
  return data
}

export async function listUsers() {
  const data = await invokeAdminUsers({ action: 'list' })
  return data.users || []
}

export async function createUser({ email, password, fullName = '', role = 'user' }) {
  const data = await invokeAdminUsers({
    action: 'create',
    email,
    password,
    fullName,
    role,
  })
  return data.user
}

export async function setUserActive(userId, isActive) {
  const data = await invokeAdminUsers({
    action: 'set-active',
    userId,
    isActive,
  })
  return data.user
}

export async function setUserRole(userId, role) {
  const data = await invokeAdminUsers({
    action: 'set-role',
    userId,
    role,
  })
  return data.user
}

export async function deleteUser(userId) {
  return invokeAdminUsers({
    action: 'delete',
    userId,
  })
}
